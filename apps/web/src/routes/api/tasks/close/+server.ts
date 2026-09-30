import { json, type RequestHandler } from '@sveltejs/kit';
import { taskCloseSchema } from '$lib/tasks/apiSchemas';
import { abortTask, completeTask, getTask } from '$lib/db/tasks';
import { farmTimeZone } from '$lib/db/userProfile';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { withClientRecordId } from '$lib/server/clientRecordId';
import { afterSeedStartTaskDone } from '$lib/server/seedStartTasks';
import { writeRecord } from '$lib/server/recordWrite';
import { careMetaOf, closeCareTask } from '$lib/server/carePlans';
import { recordTaskTime, timeOnClosedTask } from '$lib/server/taskTime';

const DAY_MS = 86_400_000;

export const _requestSchema = taskCloseSchema;

/**
 * POST /api/tasks/close: the offline queue's replay of a Done or Skip made
 * on /today with no signal. Idempotent: a task that is already closed
 * answers 200 with its current state, so a replay that already landed
 * never overwrites it. The moment the owner tapped is kept, but never a
 * future one, and never one more than 30 days back.
 *
 * An animal-care task (32D) closes through `closeCareTask`: a vaccine,
 * wormer or treatment must carry `healthEvent`, which is saved through the
 * 32C health writer and the hold guard in the same transaction, and the
 * plan's next due day rolls forward. Replayable with the client record id.
 * A dose sent for a task that was already closed another way (a plan edit,
 * the subject leaving, another device) is still saved, never dropped, so
 * the withdrawal hold it starts is on file.
 *
 * Phase 32F (F1-13 to F1-15): Done may carry `minutes`, saved as a time row
 * for the person closing in the same transaction. Time sent for a task
 * someone else already closed is still saved (`timeSaved: true`); a replay
 * of the same client record id writes nothing.
 */
export const POST: RequestHandler = withClientRecordId(async (event) => {
  const auth = currentUser(event);
  if (!auth) return json({ error: 'sign in first' }, { status: 401 });
  if (!canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = taskCloseSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request' }, { status: 400 });
  }
  const { taskId, action, reason, minutes } = parsed.data;
  const existing = getTask(taskId);
  if (!existing) return json({ error: 'task not found' }, { status: 404 });
  const meta = careMetaOf(existing);
  const carriesDose = !!meta && action === 'complete' && !!parsed.data.healthEvent;
  const now = Date.now();
  const at = Math.min(now, Math.max(now - 30 * DAY_MS, parsed.data.occurredAt ?? now));
  if ((existing.completedAt !== undefined || existing.abortedAt !== undefined) && !carriesDose) {
    return action === 'complete'
      ? timeOnClosedTask(event, auth, existing, minutes, at)
      : json({ task: existing, alreadyClosed: true });
  }
  if (meta) {
    return closeCareTask({
      event,
      user: auth,
      task: existing,
      meta,
      input: parsed.data,
      timeZone: farmTimeZone()
    });
  }
  const { task, seedStart, timeSaved } = writeRecord(event, () => {
    if (action !== 'complete') {
      return {
        task: abortTask(taskId, reason?.trim() || undefined, true, at),
        seedStart: null,
        timeSaved: false
      };
    }
    const task = completeTask(taskId, { occurredAt: at });
    const time = recordTaskTime({
      task,
      userId: auth.id,
      minutes,
      occurredAt: at,
      request: event.request
    });
    return { task, seedStart: afterSeedStartTaskDone(task, at), timeSaved: !!time };
  });
  return json({
    task,
    alreadyClosed: false,
    ...(seedStart ? { seedStart } : {}),
    ...(timeSaved ? { timeSaved: true } : {})
  });
});
