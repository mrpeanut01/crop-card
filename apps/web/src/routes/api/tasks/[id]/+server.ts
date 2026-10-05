/**
 * GET    /api/tasks/:id          — fetch primary + linked pre/post-tasks
 * PATCH  /api/tasks/:id          — { action: 'complete' | 'abort' | 'reschedule' | 'edit' | 'assign' }
 *
 * `edit`, `reschedule` and `assign` take an optional `base` and answer 409
 * `EDIT_CONFLICT` on a stale edit (Phase 36). Closing a task never reads it.
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
import { withClientRecordId } from '$lib/server/clientRecordId';
import {
  changedValues,
  editConflictResponse,
  runCheckedEdit,
  taskEditValues
} from '$lib/server/editConflict';
import { recordTaskTime, timeOnClosedTask } from '$lib/server/taskTime';
import {
  assignRefusal,
  canAssignTasks,
  rejectUnassignable,
  taskClosedRefusal
} from '$lib/server/taskAssign';
import { taskPatchSchema } from '$lib/tasks/apiSchemas';
import { t } from '$lib/i18n';

export const _requestSchema = taskPatchSchema;

class TaskClosedDuringEdit extends Error {}

export const GET: RequestHandler = ({ params, locals }) => {
  if (!params.id) throw error(400, t(locals?.locale, 'stockui.api.idRequired'));
  const result = getTaskWithLinked(params.id);
  if (!result) throw error(404, t(locals?.locale, 'api.errB.taskNotFound'));
  return json(result);
};

export const PATCH: RequestHandler = withClientRecordId(async (event) => {
  if (!event.params.id) throw error(400, t(event.locals?.locale, 'stockui.api.idRequired'));
  const auth = currentUser(event);
  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.invalidJsonShort') },
      { status: 400 }
    );
  }
  const parsed = taskPatchSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        error: t(event.locals?.locale, 'stockui.api.invalidRequest'),
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
    return json(
      { error: t(event.locals?.locale, 'stockui.api.inspectorReadOnly') },
      { status: 403 }
    );
  }
  if (parsed.data.action === 'assign') {
    if (!canAssignTasks(auth)) return assignRefusal(event.locals?.locale);
    const existing = getTask(id);
    if (!existing)
      return json({ error: t(event.locals?.locale, 'api.errB.taskNotFound') }, { status: 404 });
    if (existing.completedAt !== undefined || existing.abortedAt !== undefined) {
      return taskClosedRefusal(event.locals?.locale);
    }
    const refused = rejectUnassignable(parsed.data.assigneeUserId, event.locals?.locale);
    if (refused) return refused;
    const assigneeUserId = parsed.data.assigneeUserId;
    let out;
    try {
      out = runCheckedEdit(event, {
        target: 'task',
        id,
        action: 'assign',
        base: parsed.data.base,
        mine: { assigneeUserId },
        locale: event.locals?.locale,
        read: () => getTask(id),
        values: taskEditValues,
        write: () => {
          const task = assignTask(id, assigneeUserId);
          if (!task) throw new TaskClosedDuringEdit();
          return task;
        }
      });
    } catch (e) {
      if (e instanceof TaskClosedDuringEdit) return taskClosedRefusal(event.locals?.locale);
      throw e;
    }
    if (!out.ok) {
      if (out.status === 409) return editConflictResponse(out.body);
      return json({ error: t(event.locals?.locale, 'api.errB.taskNotFound') }, { status: 404 });
    }
    return json({ task: out.value });
  }
  if (parsed.data.action === 'complete') {
    const existing = getTask(id);
    if (!existing)
      return json({ error: t(event.locals?.locale, 'api.errB.taskNotFound') }, { status: 404 });
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
  if (parsed.data.action === 'abort') {
    try {
      return json({ task: abortTask(id, parsed.data.reason) });
    } catch (e) {
      if (e instanceof Error && /unknown task id/i.test(e.message)) {
        return json({ error: t(event.locals?.locale, 'api.errB.taskNotFound') }, { status: 404 });
      }
      throw e;
    }
  }
  if (!getTask(id))
    return json({ error: t(event.locals?.locale, 'api.errB.taskNotFound') }, { status: 404 });
  const patch =
    parsed.data.action === 'reschedule'
      ? { scheduledFor: parsed.data.scheduledFor }
      : { title: parsed.data.title, body: parsed.data.body };
  const out = runCheckedEdit(event, {
    target: 'task',
    id,
    action: parsed.data.action,
    base: parsed.data.base,
    mine: changedValues(patch),
    locale: event.locals?.locale,
    read: () => getTask(id),
    values: taskEditValues,
    write: () => updateTask(id, patch)
  });
  if (!out.ok) {
    if (out.status === 409) return editConflictResponse(out.body);
    return json({ error: t(event.locals?.locale, 'api.errB.taskNotFound') }, { status: 404 });
  }
  return json({ task: out.value });
});

/**
 * DELETE /api/tasks/:id
 *
 * Hard delete (vs. PATCH abort which is the soft path). Cascades to any
 * pre/post-tasks linked to this primary so a forgotten test task doesn't
 * leave orphaned wraparounds.
 */
export const DELETE: RequestHandler = async (eventCtx) => {
  if (!eventCtx.params.id) throw error(400, t(eventCtx.locals?.locale, 'stockui.api.idRequired'));
  const auth = currentUser(eventCtx);
  if (auth && !canMutate(auth.role)) {
    return json(
      { error: t(eventCtx.locals?.locale, 'stockui.api.inspectorReadOnly') },
      { status: 403 }
    );
  }
  const { deleteTask } = await import('$lib/db/admin');
  return json(deleteTask(eventCtx.params.id));
};
