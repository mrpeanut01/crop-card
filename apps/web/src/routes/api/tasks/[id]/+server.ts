/**
 * GET    /api/tasks/:id          — fetch primary + linked pre/post-tasks
 * PATCH  /api/tasks/:id          — { action: 'complete' | 'abort' | 'reschedule' | 'edit' }
 *
 * Aborting a primary cascades to its open pre/post-tasks (with the same
 * abort reason). Completing a primary leaves pre/post-tasks alone — the
 * operator marks each independently (e.g. "I did the calibration check
 * yesterday but the spray is later today").
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { abortTask, completeTask, getTaskWithLinked, updateTask } from '$lib/db/tasks';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('complete'),
    occurredAt: z.number().int().optional()
  }),
  z.object({
    action: z.literal('abort'),
    reason: z.string().max(500).optional()
  }),
  z.object({
    action: z.literal('reschedule'),
    scheduledFor: z.number().int()
  }),
  z.object({
    action: z.literal('edit'),
    title: z.string().min(1).max(120).optional(),
    body: z.string().max(500).optional()
  })
]);

export const GET: RequestHandler = ({ params }) => {
  if (!params.id) throw error(400, 'id required');
  const result = getTaskWithLinked(params.id);
  if (!result) throw error(404, 'task not found');
  return json(result);
};

export const PATCH: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
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
  if (parsed.data.action === 'complete') {
    return json({ task: completeTask(id, { occurredAt: parsed.data.occurredAt }) });
  }
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
