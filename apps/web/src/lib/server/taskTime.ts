/**
 * Phase 32F (F1-13, F1-14). The one writer of time on Done. Call it inside
 * the close's `writeRecord()` transaction, so the time row, the close and
 * the replay receipt commit together and a replay writes nothing twice.
 */

import { json } from '@sveltejs/kit';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { insertTimeEntry, placeOfTask, type TimeEntryRow } from '$lib/db/taskTime';
import { isTaskMinutes } from '$lib/labour/hours';
import { writeRecord } from './recordWrite';

export interface TaskTimeInput {
  task: { id: string; cropId?: string | null; blockId?: string | null };
  /** The person closing, never the assignee. */
  userId: string;
  minutes: number | undefined;
  /** When the work finished (the close time). */
  occurredAt: number;
  request?: Request;
}

export function recordTaskTime(input: TaskTimeInput): TimeEntryRow | null {
  if (!isTaskMinutes(input.minutes)) return null;
  const place = placeOfTask(input.task);
  const raw = input.request?.headers.get(CLIENT_RECORD_HEADER) ?? null;
  return insertTimeEntry({
    taskId: input.task.id,
    userId: input.userId,
    cropId: input.task.cropId ?? null,
    blockId: place.blockId,
    fieldId: place.fieldId,
    startedAt: input.occurredAt - input.minutes * 60_000,
    minutes: input.minutes,
    source: 'task-close',
    clientRecordId: raw && raw.length <= 80 ? raw : null
  });
}

/** F1-15: Done with time on a task someone else already closed. The work
 *  was done, so the time is kept; the close itself is left as it was. */
export function timeOnClosedTask(
  event: { request: Request },
  user: { id: string } | null,
  task: TaskTimeInput['task'],
  minutes: number | undefined,
  occurredAt: number
): Response {
  if (!user || !isTaskMinutes(minutes)) return json({ task, alreadyClosed: true });
  writeRecord(event, () =>
    recordTaskTime({ task, userId: user.id, minutes, occurredAt, request: event.request })
  );
  return json({ task, alreadyClosed: true, timeSaved: true });
}
