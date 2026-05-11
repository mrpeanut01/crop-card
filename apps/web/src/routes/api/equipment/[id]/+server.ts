import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { deleteEquipmentCascade } from '$lib/db/admin';
import { getEquipment, listEquipmentLog, updateEquipment } from '$lib/db/equipment';
import { currentUser, requireOwner } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

export const GET: RequestHandler = ({ params, url }) => {
  if (!params.id) return json({ error: 'id required' }, { status: 400 });
  const equipment = getEquipment(params.id);
  if (!equipment) return json({ error: 'not found' }, { status: 404 });
  const logLimit = Number(url.searchParams.get('logLimit') ?? '50');
  const log = listEquipmentLog(params.id, { limit: logLimit });
  return json({ equipment, log });
};

const patchSchema = z
  .object({
    label: z.string().min(1).max(120).optional(),
    notes: z.string().max(500).optional()
  })
  .refine((v) => v.label !== undefined || v.notes !== undefined, {
    message: 'at least one field required'
  });

export const PATCH: RequestHandler = async (event) => {
  requireOwner(event);
  if (!event.params.id) return json({ error: 'id required' }, { status: 400 });
  if (!getEquipment(event.params.id)) return json({ error: 'not found' }, { status: 404 });
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
  const patch: { label?: string; notes?: string } = {};
  if (parsed.data.label !== undefined) patch.label = parsed.data.label.trim();
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
  const equipment = updateEquipment(event.params.id, patch);
  return json({ equipment });
};

/**
 * DELETE /api/equipment/:id
 *
 * Cascade-removes equipment_state, equipment_log, and pending_calibrations
 * for this row, nulls out tasks.equipment_id + insecticide_events.sprayerId,
 * then drops the equipment row itself.
 */
export const DELETE: RequestHandler = (event) => {
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  if (!event.params.id) return json({ error: 'id required' }, { status: 400 });
  const equipment = getEquipment(event.params.id);
  if (!equipment) return json({ error: 'not found' }, { status: 404 });
  const result = deleteEquipmentCascade(event.params.id);
  return json(result);
};
