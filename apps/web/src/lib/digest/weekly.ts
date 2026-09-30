/**
 * Phase 32F (F4-1, F4-5, F4-6, F4-7). The Monday summary, built once per
 * person from rows the caller already read. Pure and client-safe: the push
 * tick, the email, the /today card and the printed Card all start here.
 *
 * Safety alerts are never part of it (F4-6): decon, lock window, frost,
 * withdrawal, grazing and hold facts keep their own immediate alerts. Only
 * primary tasks and animal care titles are listed, so a sprayer's decon
 * follow-up task never shows as a line, and a spray task is never shown by
 * its free text (F3-4), which could hold a rate.
 */

import { dueYmd, ymdInZone } from '$lib/prefs';
import { addDaysYmd, weekdayOfYmd } from '$lib/today/views';
import {
  TASK_DETAILS_HINT,
  TASK_DETAILS_TEXT,
  isSprayTaskLike,
  unsafeOnPaper
} from '$lib/tasks/printSafe';

/** Lines listed per section before "and N more". */
export const DIGEST_LIST_LIMIT = 8;

export const SPRAY_TASK_LABEL = 'Spray task';
export const SPRAY_TASK_HINT = 'See the Spray Card';

/** Spray, insecticide and fungicide work (F3-4), judged the same way the
 *  printed Week and Month Cards judge it. */
export function isSprayTask(t: {
  category?: string | null;
  relatedEventTable?: string | null;
  title?: string | null;
}): boolean {
  return isSprayTaskLike(t);
}

export interface DigestTask {
  id: string;
  title: string;
  scheduledFor: number;
  /** Completed or skipped time; absent while open. */
  completedAt?: number | null;
  abortedAt?: number | null;
  assigneeUserId?: string | null;
  /** From the task row's assignee join when the caller has it. */
  assigneeName?: string | null;
  /** Spray, insecticide or fungicide work: printed without its title. */
  isSpray?: boolean;
  /** Area or bed name. */
  where?: string | null;
}

export interface DigestTimeEntry {
  userId: string | null;
  minutes: number;
  /** Start of the work, else when it was logged. */
  atMs: number;
}

export interface WeeklyDigestInput {
  viewerId: string;
  isOwner: boolean;
  /** The Monday that starts the week, `YYYY-MM-DD` (F4-1). */
  weekStartYmd: string;
  /** Farm time zone for due days and "last week". */
  timeZone: string;
  nowMs: number;
  /** Open primary tasks; anything outside overdue and this week is ignored. */
  openTasks: readonly DigestTask[];
  /** Open animal care tasks. Titles only, never a dose. */
  careDue?: readonly DigestTask[];
  lowStockCount: number;
  /** Primary tasks closed recently. Absent on /today, which has no such rows. */
  closedTasks?: readonly DigestTask[];
  /** Time logged recently. Absent on /today. */
  timeEntries?: readonly DigestTimeEntry[];
  /** When each harvest was recorded. Absent on /today. */
  harvestsAt?: readonly number[];
  /** Member names by user id (`memberName`). */
  people?: Readonly<Record<string, string>>;
  /** Owner email only: last week's cash from the ledger. Ignored for anyone else. */
  cash?: { incomeCents: number; expenseCents: number; netCents: number } | null;
}

export interface DigestLine {
  id: string;
  /** "Spray task" for spray work. */
  text: string;
  dueYmd: string;
  where: string | null;
  assignee: string | null;
  spray: boolean;
  /** The title held a rate or mixing step, so only the Task Card shows it. */
  details?: boolean;
}

export interface DigestPersonCount {
  userId: string | null;
  name: string;
  count: number;
}

export interface DigestLastWeek {
  fromYmd: string;
  toYmd: string;
  done: number;
  skipped: number;
  /** Null when the caller had no time rows to read. */
  minutes: number | null;
  /** Owner only. */
  minutesByPerson: DigestPersonCount[];
  harvests: number | null;
}

export interface WeeklyDigest {
  viewerId: string;
  isOwner: boolean;
  weekStartYmd: string;
  weekEndYmd: string;
  todayYmd: string;
  /** Open tasks due from today to Sunday, as this person sees them. */
  dueThisWeek: DigestLine[];
  dueThisWeekCount: number;
  overdue: DigestLine[];
  overdueCount: number;
  /** Owner: open tasks this week per person, unassigned last. */
  byPerson: DigestPersonCount[];
  /** Helper: open tasks this week that nobody has. */
  unassignedCount: number;
  careDue: DigestLine[];
  careDueCount: number;
  lastWeek: DigestLastWeek | null;
  lowStockCount: number;
  /** Owner only, and only when the caller passed it (the email). */
  cash: { incomeCents: number; expenseCents: number; netCents: number } | null;
}

/** The Monday of the week that holds `ymd`. */
export function mondayOf(ymd: string): string {
  const back = (weekdayOfYmd(ymd) + 6) % 7;
  return addDaysYmd(ymd, -back);
}

function isOpen(t: DigestTask): boolean {
  return t.completedAt == null && t.abortedAt == null;
}

function lineFor(
  t: DigestTask,
  timeZone: string,
  people: Readonly<Record<string, string>>,
  care = false
) {
  const assignee = t.assigneeUserId
    ? (t.assigneeName ?? people[t.assigneeUserId] ?? 'Farm member')
    : null;
  const spray = !care && (!!t.isSpray || isSprayTaskLike({ title: t.title }));
  const hidden = !spray && unsafeOnPaper(t.title);
  const where = t.where && !unsafeOnPaper(t.where) ? t.where : null;
  const safeText = care ? 'Animal care task' : TASK_DETAILS_TEXT;
  return {
    id: t.id,
    text: spray ? SPRAY_TASK_LABEL : hidden ? safeText : t.title,
    dueYmd: dueYmd(t.scheduledFor, timeZone),
    where,
    assignee,
    spray,
    ...(hidden ? { details: true } : {})
  } satisfies DigestLine;
}

function byDue(a: DigestLine, b: DigestLine): number {
  return a.dueYmd.localeCompare(b.dueYmd) || a.text.localeCompare(b.text);
}

export function buildWeeklyDigest(input: WeeklyDigestInput): WeeklyDigest {
  const { timeZone, viewerId, isOwner } = input;
  const people = input.people ?? {};
  const weekStartYmd = input.weekStartYmd;
  const weekEndYmd = addDaysYmd(weekStartYmd, 6);
  const todayYmd = ymdInZone(input.nowMs, timeZone);
  const mine = (t: DigestTask) => !!viewerId && t.assigneeUserId === viewerId;

  const open = input.openTasks.filter(isOpen);
  const overdueAll = open.filter((t) => dueYmd(t.scheduledFor, timeZone) < todayYmd);
  const weekAll = open.filter((t) => {
    const due = dueYmd(t.scheduledFor, timeZone);
    return due >= todayYmd && due >= weekStartYmd && due <= weekEndYmd;
  });

  const visibleWeek = isOwner ? weekAll : weekAll.filter(mine);
  const visibleOverdue = isOwner ? overdueAll : overdueAll.filter(mine);

  const byPerson: DigestPersonCount[] = [];
  if (isOwner) {
    const counts = new Map<string | null, DigestPersonCount>();
    for (const t of weekAll) {
      const id = t.assigneeUserId ?? null;
      const hit = counts.get(id);
      if (hit) hit.count++;
      else
        counts.set(id, {
          userId: id,
          name: id ? (t.assigneeName ?? people[id] ?? 'Farm member') : 'Not assigned',
          count: 1
        });
    }
    const assigned = [...counts.values()].filter((p) => p.userId !== null);
    assigned.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    byPerson.push(...assigned);
    const none = counts.get(null);
    // Only worth a line once somebody on the farm has work handed to them.
    if (none && assigned.length > 0) byPerson.push(none);
  }

  const careAll = (input.careDue ?? []).filter((t) => {
    if (!isOpen(t)) return false;
    const due = dueYmd(t.scheduledFor, timeZone);
    return due <= weekEndYmd;
  });

  const lastFrom = addDaysYmd(weekStartYmd, -7);
  const lastTo = addDaysYmd(weekStartYmd, -1);
  const inLastWeek = (ms: number) => {
    const d = ymdInZone(ms, timeZone);
    return d >= lastFrom && d <= lastTo;
  };

  let lastWeek: DigestLastWeek | null = null;
  if (input.closedTasks || input.timeEntries || input.harvestsAt) {
    let done = 0;
    let skipped = 0;
    for (const t of input.closedTasks ?? []) {
      if (!isOwner && !mine(t)) continue;
      if (t.completedAt != null && inLastWeek(t.completedAt)) done++;
      else if (t.abortedAt != null && t.completedAt == null && inLastWeek(t.abortedAt)) skipped++;
    }
    let minutes: number | null = null;
    const perPerson = new Map<string | null, number>();
    if (input.timeEntries) {
      minutes = 0;
      for (const e of input.timeEntries) {
        if (!inLastWeek(e.atMs)) continue;
        if (!isOwner && e.userId !== viewerId) continue;
        minutes += e.minutes;
        perPerson.set(e.userId, (perPerson.get(e.userId) ?? 0) + e.minutes);
      }
    }
    const minutesByPerson: DigestPersonCount[] = isOwner
      ? [...perPerson.entries()]
          .map(([userId, count]) => ({
            userId,
            name: userId ? (people[userId] ?? 'Farm member') : 'Someone no longer on the farm',
            count
          }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      : [];
    lastWeek = {
      fromYmd: lastFrom,
      toYmd: lastTo,
      done,
      skipped,
      minutes,
      minutesByPerson,
      harvests: input.harvestsAt ? input.harvestsAt.filter(inLastWeek).length : null
    };
  }

  const lines = (list: readonly DigestTask[]) =>
    list.map((t) => lineFor(t, timeZone, people)).sort(byDue);

  return {
    viewerId,
    isOwner,
    weekStartYmd,
    weekEndYmd,
    todayYmd,
    dueThisWeek: lines(visibleWeek),
    dueThisWeekCount: visibleWeek.length,
    overdue: lines(visibleOverdue),
    overdueCount: visibleOverdue.length,
    byPerson,
    unassignedCount: isOwner ? 0 : weekAll.filter((t) => !t.assigneeUserId).length,
    careDue: careAll.map((t) => lineFor(t, timeZone, people, true)).sort(byDue),
    careDueCount: careAll.length,
    lastWeek,
    lowStockCount: Math.max(0, input.lowStockCount),
    cash: isOwner && input.cash ? { ...input.cash } : null
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** F4-7: short and never about money, since it shows on a lock screen. */
export function digestPushBody(d: WeeklyDigest): string {
  const parts = [plural(d.dueThisWeekCount, 'task', 'tasks')];
  if (d.overdueCount > 0) parts.push(`${d.overdueCount} overdue`);
  if (d.careDueCount > 0) parts.push(plural(d.careDueCount, 'animal care job', 'animal care jobs'));
  return `Your week: ${parts.join(', ')}`;
}

/** Cash in and out over the farm-local days `[fromYmd, toYmd]`. */
export function cashForDays(
  entries: readonly { kind: 'income' | 'expense'; amountCents: number; occurredAt: number }[],
  fromYmd: string,
  toYmd: string,
  timeZone: string
): { incomeCents: number; expenseCents: number; netCents: number } {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const e of entries) {
    const d = ymdInZone(e.occurredAt, timeZone);
    if (d < fromYmd || d > toYmd) continue;
    if (e.kind === 'income') incomeCents += e.amountCents;
    else expenseCents += e.amountCents;
  }
  return { incomeCents, expenseCents, netCents: incomeCents - expenseCents };
}

/** "45 min", "1.5 h": whole minutes under an hour, else hours to the
 *  nearest quarter. */
export function digestHours(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const quarters = Math.round(minutes / 15) / 4;
  return `${quarters} h`;
}

/** "Mon Sep 28" from a `YYYY-MM-DD`, without a locale lookup. */
export function shortDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    d.getUTCMonth()
  ];
  return `${wd} ${mo} ${d.getUTCDate()}`;
}

/** One printed or emailed line for a task. */
export function digestLineText(l: DigestLine, opts: { withAssignee: boolean }): string {
  const parts = [`${shortDay(l.dueYmd)}: ${l.text}`];
  if (l.where) parts.push(l.where);
  if (l.spray) parts.push(SPRAY_TASK_HINT);
  else if (l.details) parts.push(TASK_DETAILS_HINT);
  if (opts.withAssignee && l.assignee) parts.push(l.assignee);
  return parts.join(', ');
}

export function limited(items: string[], limit = DIGEST_LIST_LIMIT): string[] {
  if (items.length <= limit) return items;
  return [...items.slice(0, limit), `And ${items.length - limit} more`];
}
