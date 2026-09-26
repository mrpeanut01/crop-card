import { dueYmd, ymdInZone } from '$lib/prefs';
import type { PillTone } from '$lib/styles/tokens';

export const TASK_STATUSES = ['late', 'due-today', 'planned', 'done', 'skipped'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskStatusInput {
  scheduledFor: number;
  completedAt?: number | null;
  abortedAt?: number | null;
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  late: 'Late',
  'due-today': 'Due today',
  planned: 'Planned',
  done: 'Done',
  skipped: 'Skipped'
};

export const TASK_STATUS_TONE: Record<TaskStatus, PillTone> = {
  late: 'rust',
  'due-today': 'wheat',
  planned: 'neutral',
  done: 'forest',
  skipped: 'sky'
};

function isSet(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Derived, never stored. Done and skipped come from the closing stamps;
 * an open task compares its due day (`dueYmd`: a date-only task keeps its
 * stored day, a timed one falls in the owner's zone) with today's in the
 * owner's zone, so a 23:30 task is still "due today" at 23:59 and "late"
 * one minute later, whatever the clocks did overnight.
 */
export function deriveTaskStatus(task: TaskStatusInput, now: number, timeZone: string): TaskStatus {
  if (isSet(task.completedAt)) return 'done';
  if (isSet(task.abortedAt)) return 'skipped';
  const due = dueYmd(task.scheduledFor, timeZone);
  const today = ymdInZone(now, timeZone);
  if (due < today) return 'late';
  if (due === today) return 'due-today';
  return 'planned';
}

export function isClosedStatus(status: TaskStatus): boolean {
  return status === 'done' || status === 'skipped';
}

/** The day a closed task was closed, in the owner's zone. */
export function closedOnYmd(task: TaskStatusInput, timeZone: string): string | null {
  const at = isSet(task.completedAt)
    ? task.completedAt
    : isSet(task.abortedAt)
      ? task.abortedAt
      : null;
  return at === null ? null : ymdInZone(at, timeZone);
}

export type QueuedTaskAction = 'complete' | 'abort';

/** What the owner sees while a Done or Skip waits in the offline queue. */
export function statusWithQueued(status: TaskStatus, queued: QueuedTaskAction | null): TaskStatus {
  if (queued === 'complete') return 'done';
  if (queued === 'abort') return 'skipped';
  return status;
}

const STATUS_RANK: Record<TaskStatus, number> = {
  late: 0,
  'due-today': 1,
  planned: 2,
  done: 3,
  skipped: 4
};

export function compareByStatus(
  a: { status: TaskStatus; scheduledFor: number; id: string },
  b: { status: TaskStatus; scheduledFor: number; id: string }
): number {
  return (
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    a.scheduledFor - b.scheduledFor ||
    a.id.localeCompare(b.id)
  );
}
