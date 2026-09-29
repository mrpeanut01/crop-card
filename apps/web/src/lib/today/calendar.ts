/**
 * Week and Month calendar cells for /today: one read-only chip per task or
 * crop-calendar suggestion, keyed by the owner's calendar day. Pure and
 * client-safe; tapping a chip opens the full card in a sheet.
 */

import { dueYmd } from '$lib/prefs';
import type { TaskStatus } from '$lib/tasks/status';
import type { TaskCategory } from '$lib/plan/taskCategory';
import type { DeckEntry, DeckTaskLike } from './deck';

export type CalendarKind = 'scout' | 'spray' | 'harvest' | 'fertility' | 'planting' | 'task';

export const CALENDAR_KIND_LABEL: Record<CalendarKind, string> = {
  scout: 'Scout',
  spray: 'Spray',
  harvest: 'Harvest',
  fertility: 'Feed',
  planting: 'Plant',
  task: 'Task'
};

export interface CalendarTaskLike extends DeckTaskLike {
  title: string;
  blockId?: string;
  cropId?: string;
  category?: TaskCategory;
  relatedEventTable?: string;
  pluginTemplateKey?: string;
}

export function kindForTask(t: {
  category?: TaskCategory;
  relatedEventTable?: string;
}): CalendarKind {
  switch (t.relatedEventTable) {
    case 'spray_event':
    case 'insecticide_event':
    case 'fungicide_event':
      return 'spray';
    case 'harvest_event':
    case 'hay_cutting':
      return 'harvest';
    case 'fertility_application':
      return 'fertility';
  }
  switch (t.category) {
    case 'spray':
      return 'spray';
    case 'scout':
      return 'scout';
    case 'harvest':
    case 'hay-cutting':
      return 'harvest';
    case 'fertilize':
      return 'fertility';
    case 'plant':
      return 'planting';
    default:
      return 'task';
  }
}

export interface SuggestionLike {
  kind: string;
  blockId: string;
  startMs: number;
  endMs: number;
  title: string;
}

export function kindForEvent(e: { kind: string }): CalendarKind {
  switch (e.kind) {
    case 'spray-window':
      return 'spray';
    case 'harvest-window':
    case 'curing-ready':
      return 'harvest';
    case 'planting':
    case 'cover-termination':
      return 'planting';
    default:
      return 'task';
  }
}

/** Calendar-engine kinds that describe the crop rather than a job. */
export const PASSIVE_EVENT_KINDS = new Set([
  'emergence',
  'stage-window',
  'shade-window',
  'curing-progress'
]);

/** The key a Schedule from /today writes, so a scheduled suggestion is
 *  not offered twice. */
export function suggestionTemplateKey(e: SuggestionLike): string {
  return `derived:${e.kind}:${e.blockId}:${e.startMs}`;
}

/** When a scheduled suggestion is due: the day the owner tapped it on, or
 *  the first day of its window that is not in the past. A date-only
 *  instant (UTC midnight) so it reads as that day in every time zone. */
export function suggestionScheduleMs(
  e: Pick<SuggestionLike, 'startMs'>,
  todayYmd: string,
  timeZone: string,
  dayYmd?: string | null
): number {
  const start = dueYmd(e.startMs, timeZone);
  const day = dayYmd ?? (start < todayYmd ? todayYmd : start);
  return Date.parse(day);
}

export type CalendarChip =
  | {
      type: 'task';
      key: string;
      taskId: string;
      kind: CalendarKind;
      title: string;
      blockId: string | null;
      status: TaskStatus;
      queued: boolean;
      extra: number;
    }
  | {
      type: 'suggestion';
      key: string;
      index: number;
      kind: CalendarKind;
      title: string;
      blockId: string;
    };

export interface CalendarCellsInput<T extends CalendarTaskLike, E extends SuggestionLike> {
  entries: readonly DeckEntry<T>[];
  suggestions: readonly E[];
  /** Every task on the farm in range, to hide suggestions already scheduled. */
  scheduledKeys: ReadonlySet<string>;
  fromYmd: string;
  toYmd: string;
  todayYmd: string;
  timeZone: string;
}

function blockFor(t: CalendarTaskLike, linked: readonly { task: CalendarTaskLike }[]) {
  return t.blockId ?? linked.find((l) => l.task.blockId)?.task.blockId ?? null;
}

/**
 * Chips per day. A task sits on its due day. A suggestion sits on the first
 * day of its window that is today or later and inside the grid, since a
 * window that has already closed is no longer something to schedule.
 */
export function calendarCells<T extends CalendarTaskLike, E extends SuggestionLike>(
  input: CalendarCellsInput<T, E>
): Record<string, CalendarChip[]> {
  const out: Record<string, CalendarChip[]> = {};
  for (const e of input.entries) {
    const day = dueYmd(e.task.scheduledFor, input.timeZone);
    (out[day] ??= []).push({
      type: 'task',
      key: `t:${e.task.id}`,
      taskId: e.task.id,
      kind: kindForTask(e.task),
      title: e.task.title,
      blockId: blockFor(e.task, e.linked),
      status: e.status,
      queued: e.queued !== null,
      extra: e.linked.length
    });
  }
  input.suggestions.forEach((s, index) => {
    if (PASSIVE_EVENT_KINDS.has(s.kind)) return;
    if (input.scheduledKeys.has(suggestionTemplateKey(s))) return;
    const start = dueYmd(s.startMs, input.timeZone);
    const end = dueYmd(s.endMs, input.timeZone);
    let day = start;
    if (day < input.todayYmd) day = input.todayYmd;
    if (day < input.fromYmd) day = input.fromYmd;
    if (day > end || day > input.toYmd) return;
    (out[day] ??= []).push({
      type: 'suggestion',
      key: `s:${index}`,
      index,
      kind: kindForEvent(s),
      title: s.title,
      blockId: s.blockId
    });
  });
  return out;
}
