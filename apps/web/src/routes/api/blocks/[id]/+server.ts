/**
 * GET    /api/blocks/:id  — fetch one block with its plantings
 * PATCH  /api/blocks/:id  — edit name/acres/blockLabel/fieldId (Phase 13)
 * DELETE /api/blocks/:id  — heavy cascade through all crops + events
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { deleteBlockCascade } from '$lib/db/admin';
import { getBlock, updateBlock } from '$lib/db/blocks';
import { getField } from '$lib/db/fields';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

export const GET: RequestHandler = (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const block = getBlock(event.params.id);
  if (!block) throw error(404, 'block not found');
  return json({ block });
};

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  acres: z.number().positive().nullable().optional(),
  blockLabel: z.string().max(60).nullable().optional(),
  fieldId: z.string().min(1).optional(),
  tillageMethod: z.enum(['conventional', 'reduced-till', 'no-till']).optional(),
  /** v1.3 shade model — terrain slope (optional). Null clears the value. */
  slopePercent: z.number().min(0).max(100).nullable().optional(),
  slopeAspectDeg: z.number().min(0).max(360).nullable().optional()
});

export const PATCH: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  const block = getBlock(event.params.id);
  if (!block) throw error(404, 'block not found');

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  if (parsed.data.fieldId && !getField(parsed.data.fieldId)) {
    return json({ error: 'unknown fieldId' }, { status: 400 });
  }
  const updated = updateBlock(event.params.id, parsed.data);
  return json({ block: updated });
};

export const DELETE: RequestHandler = (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  const block = getBlock(event.params.id);
  if (!block) throw error(404, 'block not found');
  return json(deleteBlockCascade(event.params.id));
};
