/** Phase 33D (D-25, D-26). Pure rules for time saved from the task timer. */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** How far back a timer entry may start (the close replay's window). */
export const TIME_ENTRY_MAX_AGE_MS = 30 * DAY_MS;
/** How far past the server's clock the end of an entry may land. */
export const TIME_ENTRY_FUTURE_SLACK_MS = 5 * MINUTE_MS;
/** How long a person may remove their own entry (D-26). */
export const OWN_TIME_DELETE_WINDOW_MS = 48 * 60 * MINUTE_MS;

export const OWN_TIME_DELETE_TEXT =
  'You can remove your own time for 48 hours after saving it. Ask the owner.';

/** True when `startedAt + minutes` is a span this endpoint accepts. */
export function timeEntryInRange(startedAt: number, minutes: number, now: number): boolean {
  if (!Number.isFinite(startedAt) || !Number.isFinite(minutes)) return false;
  if (startedAt < now - TIME_ENTRY_MAX_AGE_MS) return false;
  return startedAt + minutes * MINUTE_MS <= now + TIME_ENTRY_FUTURE_SLACK_MS;
}

export type TimeDeleteVerdict = 'ok' | 'READ_ONLY' | 'NOT_YOURS' | 'TOO_LATE';

/** Owners remove any entry at any time; others only their own, within 48
 *  hours of the row's server save time; inspectors never. */
export function timeDeleteVerdict(
  entry: { userId: string | null; createdAt: number },
  user: { id: string; role: string },
  now: number
): TimeDeleteVerdict {
  if (user.role === 'owner') return 'ok';
  if (user.role === 'inspector') return 'READ_ONLY';
  if (entry.userId !== user.id) return 'NOT_YOURS';
  if (now - entry.createdAt > OWN_TIME_DELETE_WINDOW_MS) return 'TOO_LATE';
  return 'ok';
}

/** One saved entry as `GET /api/tasks/:id/time` lists it. */
export interface TaskTimeEntryView {
  id: string;
  userId: string | null;
  /** The person's name; owners only. */
  name?: string;
  startedAt: number | null;
  minutes: number;
  source: 'task-close' | 'manual' | 'timer';
  note: string | null;
  createdAt: number;
  canDelete: boolean;
}

export interface TaskTimeSummary {
  totalMinutes: number;
  entries: TaskTimeEntryView[];
}
