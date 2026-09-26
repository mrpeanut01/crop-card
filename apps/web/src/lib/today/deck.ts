import { dueYmd, ymdInZone } from '$lib/prefs';
import {
  closedOnYmd,
  compareByStatus,
  deriveTaskStatus,
  isClosedStatus,
  statusWithQueued,
  type QueuedTaskAction,
  type TaskStatus
} from '$lib/tasks/status';

const DAY_MS = 86_400_000;

export type TodayWindow = 'today' | '7d' | '30d' | 'season';
export type TodayView = 'list' | 'calendar';
export type WeekPeriod = 'week' | 'month' | 'season';

export const TODAY_WINDOWS: { id: TodayWindow; label: string; days: number }[] = [
  { id: 'today', label: 'Today', days: 1 },
  { id: '7d', label: 'Next 7 days', days: 7 },
  { id: '30d', label: 'Next 30 days', days: 30 },
  { id: 'season', label: 'Season', days: 200 }
];

export const SEASON_DAYS = 200;
export const CALENDAR_DAYS = 84;

export function clampWindow(raw: string | null | undefined): TodayWindow {
  return raw === '7d' || raw === '30d' || raw === 'season' ? raw : 'today';
}

export function clampView(raw: string | null | undefined): TodayView {
  return raw === 'calendar' ? 'calendar' : 'list';
}

export function periodForWindow(w: TodayWindow): WeekPeriod {
  if (w === '30d') return 'month';
  if (w === 'season') return 'season';
  return 'week';
}

export function windowDays(w: TodayWindow): number {
  return TODAY_WINDOWS.find((x) => x.id === w)?.days ?? 1;
}

function addDaysYmd(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export interface DeckTaskLike {
  id: string;
  kind: 'primary' | 'pre-task' | 'post-task';
  linkedToTaskId?: string | null;
  scheduledFor: number;
  completedAt?: number | null;
  abortedAt?: number | null;
}

export interface DeckItem<T extends DeckTaskLike> {
  task: T;
  status: TaskStatus;
  queued: QueuedTaskAction | null;
}

export interface DeckEntry<T extends DeckTaskLike> extends DeckItem<T> {
  linked: DeckItem<T>[];
}

export interface DeckOptions {
  window: TodayWindow;
  now: number;
  timeZone: string;
  queued?: ReadonlyMap<string, QueuedTaskAction>;
}

function inWindow<T extends DeckTaskLike>(
  item: DeckItem<T>,
  today: string,
  lastDay: string,
  timeZone: string
): boolean {
  if (item.queued) return true;
  if (isClosedStatus(item.status)) return closedOnYmd(item.task, timeZone) === today;
  if (item.status === 'late') return true;
  const due = dueYmd(item.task.scheduledFor, timeZone);
  return due >= today && due <= lastDay;
}

/**
 * The /today deck for one window. Late work shows in every window, done
 * and skipped work shows on the day it was closed, and prep and follow-up
 * tasks sit under their job unless that job is outside the window.
 */
export function buildTaskDeck<T extends DeckTaskLike>(
  tasks: readonly T[],
  opts: DeckOptions
): DeckEntry<T>[] {
  const today = ymdInZone(opts.now, opts.timeZone);
  const lastDay = addDaysYmd(today, windowDays(opts.window) - 1);
  const items: DeckItem<T>[] = tasks.map((task) => {
    const queued = opts.queued?.get(task.id) ?? null;
    return {
      task,
      queued,
      status: statusWithQueued(deriveTaskStatus(task, opts.now, opts.timeZone), queued)
    };
  });
  const visible = items.filter((i) => inWindow(i, today, lastDay, opts.timeZone));
  const primaryIds = new Set(
    visible.filter((i) => i.task.kind === 'primary').map((i) => i.task.id)
  );
  const byParent = new Map<string, DeckItem<T>[]>();
  const entries: DeckEntry<T>[] = [];
  for (const item of visible) {
    const parent = item.task.linkedToTaskId ?? null;
    if (item.task.kind !== 'primary' && parent && primaryIds.has(parent)) {
      const list = byParent.get(parent) ?? [];
      list.push(item);
      byParent.set(parent, list);
      continue;
    }
    entries.push({ ...item, linked: [] });
  }
  const sortKey = (i: DeckItem<T>) => ({
    status: i.status,
    scheduledFor: i.task.scheduledFor,
    id: i.task.id
  });
  for (const e of entries) {
    e.linked = (byParent.get(e.task.id) ?? []).sort((a, b) =>
      a.task.scheduledFor === b.task.scheduledFor
        ? a.task.id.localeCompare(b.task.id)
        : a.task.scheduledFor - b.task.scheduledFor
    );
  }
  return entries.sort((a, b) => compareByStatus(sortKey(a), sortKey(b)));
}

export interface DeckCounts {
  late: number;
  dueToday: number;
  planned: number;
  done: number;
  skipped: number;
}

export function deckCounts<T extends DeckTaskLike>(entries: readonly DeckEntry<T>[]): DeckCounts {
  const out: DeckCounts = { late: 0, dueToday: 0, planned: 0, done: 0, skipped: 0 };
  for (const e of entries) {
    for (const i of [e, ...e.linked]) {
      if (i.status === 'late') out.late++;
      else if (i.status === 'due-today') out.dueToday++;
      else if (i.status === 'planned') out.planned++;
      else if (i.status === 'done') out.done++;
      else out.skipped++;
    }
  }
  return out;
}

export interface WindowEvent {
  startMs: number;
  endMs: number;
}

/** Crop-calendar suggestions for a window: the ones open today for
 *  "Today", otherwise anything whose window overlaps the next N days. */
export function eventsForWindow<E extends WindowEvent>(
  upcoming: readonly E[],
  todayEvents: readonly E[],
  window: TodayWindow,
  now: number
): E[] {
  if (window === 'today') return [...todayEvents];
  const to = now + windowDays(window) * DAY_MS;
  return upcoming.filter((e) => e.endMs >= now && e.startMs <= to);
}

/** Keys an instant by the owner's calendar day, for the WeekStrip. */
export function calendarItems<T, K>(
  entries: readonly { at: number; value: T }[],
  todayYmd: string,
  timeZone: string,
  map: (v: T) => K,
  days = CALENDAR_DAYS
): Record<string, K[]> {
  const last = addDaysYmd(todayYmd, days - 1);
  const out: Record<string, K[]> = {};
  for (const e of entries) {
    const key = dueYmd(e.at, timeZone);
    if (key < todayYmd || key > last) continue;
    (out[key] ??= []).push(map(e.value));
  }
  return out;
}
