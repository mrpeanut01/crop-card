/**
 * GET  /api/crops/:id/equipment  — list bindings for this crop
 * POST /api/crops/:id/equipment  — bind equipment to the crop with a role
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import {
  bindEquipment,
  CROP_EQUIPMENT_ROLES,
  CropEquipmentBindingExistsError,
  listCropEquipment
} from '$lib/db/cropEquipment';
import { getCrop } from '$lib/db/crops';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

export const GET: RequestHandler = ({ params }) => {
  if (!params.id) throw error(400, 'id required');
  if (!getCrop(params.id)) throw error(404, 'crop not found');
  return json({ bindings: listCropEquipment(params.id) });
};

const postSchema = z.object({
  equipmentId: z.string().min(1),
  role: z.enum(CROP_EQUIPMENT_ROLES as [string, ...string[]]),
  notes: z.string().max(500).optional()
});

export const POST: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  if (!getCrop(event.params.id)) throw error(404, 'crop not found');

  let body: unknown;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'invalid request', issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const binding = bindEquipment({
      cropId: event.params.id,
      equipmentId: parsed.data.equipmentId,
      role: parsed.data.role as (typeof CROP_EQUIPMENT_ROLES)[number],
      notes: parsed.data.notes
    });
    return json({ binding }, { status: 201 });
  } catch (e) {
    if (e instanceof CropEquipmentBindingExistsError) {
      return json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
};
