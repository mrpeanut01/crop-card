/**
 * GET    /api/tasks/:id          — fetch primary + linked pre/post-tasks
 * PATCH  /api/tasks/:id          — { action: 'complete' | 'abort' | 'reschedule' | 'edit' | 'assign' }
 *
 * Aborting a primary cascades to its open pre/post-tasks (with the same
 * abort reason). Completing a primary leaves pre/post-tasks alone — the
 * operator marks each independently (e.g. "I did the calibration check
 * yesterday but the spray is later today").
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import {
  abortTask,
  assignTask,
  completeTask,
  getTask,
  getTaskWithLinked,
  updateTask
} from '$lib/db/tasks';
import { farmTimeZone } from '$lib/db/userProfile';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { careMetaOf, closeCareTask } from '$lib/server/carePlans';
import { afterSeedStartTaskDone } from '$lib/server/seedStartTasks';
import { writeRecord } from '$lib/server/recordWrite';
import { recordTaskTime, timeOnClosedTask } from '$lib/server/taskTime';
import {
  assignRefusal,
  canAssignTasks,
  rejectUnassignable,
  taskClosedRefusal
} from '$lib/server/taskAssign';
import { taskPatchSchema } from '$lib/tasks/apiSchemas';

export const _requestSchema = taskPatchSchema;

export const GET: RequestHandler = ({ params }) => {
  if (!params.id) throw error(400, 'id required');
  const result = getTaskWithLinked(params.id);
  if (!result) throw error(404, 'task not found');
  return json(result);
};

export const PATCH: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = taskPatchSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid request',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message
        }))
      },
      { status: 400 }
    );
  }

  const id = event.params.id;
  const action = parsed.data.action;
  if (parsed.data.action !== 'assign' && auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  if (parsed.data.action === 'assign') {
    if (!canAssignTasks(auth)) return assignRefusal();
    const existing = getTask(id);
    if (!existing) return json({ error: 'task not found' }, { status: 404 });
    if (existing.completedAt !== undefined || existing.abortedAt !== undefined) {
      return taskClosedRefusal();
    }
    const refused = rejectUnassignable(parsed.data.assigneeUserId);
    if (refused) return refused;
    const task = assignTask(id, parsed.data.assigneeUserId);
    if (!task) return taskClosedRefusal();
    return json({ task });
  }
  if (parsed.data.action === 'complete') {
    const existing = getTask(id);
    if (!existing) return json({ error: 'task not found' }, { status: 404 });
    const at = parsed.data.occurredAt ?? Date.now();
    const minutes = parsed.data.minutes;
    if (existing.completedAt !== undefined || existing.abortedAt !== undefined) {
      return timeOnClosedTask(event, auth, existing, minutes, at);
    }
    const meta = auth ? careMetaOf(existing) : null;
    if (auth && meta) {
      return closeCareTask({
        event,
        user: auth,
        task: existing,
        meta,
        input: { action: 'complete', occurredAt: parsed.data.occurredAt, minutes },
        timeZone: farmTimeZone()
      });
    }
    const out = writeRecord(event, () => {
      const task = completeTask(id, { occurredAt: at });
      const time = auth
        ? recordTaskTime({ task, userId: auth.id, minutes, occurredAt: at, request: event.request })
        : null;
      return { task, seedStart: afterSeedStartTaskDone(task, at), timeSaved: !!time };
    });
    return json({
      task: out.task,
      ...(out.seedStart ? { seedStart: out.seedStart } : {}),
      ...(out.timeSaved ? { timeSaved: true } : {})
    });
  }
  if (auth && action === 'abort') {
    const existing = getTask(id);
    const meta = existing ? careMetaOf(existing) : null;
    if (existing && meta) {
      if (existing.completedAt !== undefined || existing.abortedAt !== undefined) {
        return json({ task: existing, alreadyClosed: true });
      }
      return closeCareTask({
        event,
        user: auth,
        task: existing,
        meta,
        input: { action: 'abort', reason: parsed.data.reason },
        timeZone: farmTimeZone()
      });
    }
  }
  try {
    if (parsed.data.action === 'abort') {
      return json({ task: abortTask(id, parsed.data.reason) });
    }
    if (parsed.data.action === 'reschedule') {
      return json({ task: updateTask(id, { scheduledFor: parsed.data.scheduledFor }) });
    }
    // edit
    return json({
      task: updateTask(id, { title: parsed.data.title, body: parsed.data.body })
    });
  } catch (e) {
    // The repo throws `unknown task id: …` when the row doesn't exist (or is
    // out of tenant scope). Surface that as a clean 404 instead of a raw 500.
    if (e instanceof Error && /unknown task id/i.test(e.message)) {
      return json({ error: 'task not found' }, { status: 404 });
    }
    throw e;
  }
};

/**
 * DELETE /api/tasks/:id
 *
 * Hard delete (vs. PATCH abort which is the soft path). Cascades to any
 * pre/post-tasks linked to this primary so a forgotten test task doesn't
 * leave orphaned wraparounds.
 */
export const DELETE: RequestHandler = async (eventCtx) => {
  if (!eventCtx.params.id) throw error(400, 'id required');
  const auth = currentUser(eventCtx);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  const { deleteTask } = await import('$lib/db/admin');
  return json(deleteTask(eventCtx.params.id));
};
