/**
 * GET   /api/crops/:id  — fetch one crop with summary counts.
 * PATCH /api/crops/:id  — { action: 'mark-harvested' | 'archive' | 'mark-failed' | 'reactivate' }
 *
 * Status transitions stamp `harvested_at` / `archived_at` automatically.
 * Inspector role is read-only at the hooks layer.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { deleteCropCascade } from '$lib/db/admin';
import { getCrop, updateStatus } from '$lib/db/crops';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

const patchSchema = z.object({
  action: z.enum(['mark-harvested', 'archive', 'mark-failed', 'reactivate']),
  occurredAt: z.number().int().optional()
});

const ACTION_TO_STATUS = {
  'mark-harvested': 'harvested',
  archive: 'archived',
  'mark-failed': 'failed',
  reactivate: 'active'
} as const;

export const GET: RequestHandler = ({ params }) => {
  if (!params.id) throw error(400, 'id required');
  const c = getCrop(params.id);
  if (!c) throw error(404, 'crop not found');
  return json({ crop: c });
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
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }
  const status = ACTION_TO_STATUS[parsed.data.action];
  const updated = updateStatus(event.params.id, status, parsed.data.occurredAt);
  return json({ crop: updated });
};

/**
 * DELETE /api/crops/:id
 *
 * Hard delete with full cascade through all events tied to this crop:
 * spray / insecticide / harvest / hay cutting / fertility application,
 * plus any tasks (and their pre/post-tasks) and any stock_movements
 * pointing at the deleted events.
 */
export const DELETE: RequestHandler = (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  const c = getCrop(event.params.id);
  if (!c) throw error(404, 'crop not found');
  return json(deleteCropCascade(event.params.id));
};
