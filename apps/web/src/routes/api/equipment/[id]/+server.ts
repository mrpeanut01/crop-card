import { json, type RequestHandler } from '@sveltejs/kit';
import { deleteEquipmentCascade } from '$lib/db/admin';
import { getEquipment, listEquipmentLog } from '$lib/db/equipment';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

export const GET: RequestHandler = ({ params, url }) => {
  if (!params.id) return json({ error: 'id required' }, { status: 400 });
  const equipment = getEquipment(params.id);
  if (!equipment) return json({ error: 'not found' }, { status: 404 });
  const logLimit = Number(url.searchParams.get('logLimit') ?? '50');
  const log = listEquipmentLog(params.id, { limit: logLimit });
  return json({ equipment, log });
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
