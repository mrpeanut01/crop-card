import { json, type RequestHandler } from '@sveltejs/kit';
import { taskCloseSchema } from '$lib/tasks/apiSchemas';
import { abortTask, completeTask, getTask } from '$lib/db/tasks';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

const DAY_MS = 86_400_000;

export const _requestSchema = taskCloseSchema;

/**
 * POST /api/tasks/close: the offline queue's replay of a Done or Skip made
 * on /today with no signal. Idempotent: a task that is already closed
 * answers 200 with its current state, so a replay that already landed
 * never overwrites it. The moment the owner tapped is kept, but never a
 * future one, and never one more than 30 days back.
 */
export const POST: RequestHandler = async (event) => {
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
  const { taskId, action, reason } = parsed.data;
  const existing = getTask(taskId);
  if (!existing) return json({ error: 'task not found' }, { status: 404 });
  if (existing.completedAt !== undefined || existing.abortedAt !== undefined) {
    return json({ task: existing, alreadyClosed: true });
  }
  const now = Date.now();
  const at = Math.min(now, Math.max(now - 30 * DAY_MS, parsed.data.occurredAt ?? now));
  const task =
    action === 'complete'
      ? completeTask(taskId, { occurredAt: at })
      : abortTask(taskId, reason?.trim() || undefined, true, at);
  return json({ task, alreadyClosed: false });
};
