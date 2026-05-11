/**
 * DELETE /api/crops/:id/equipment/:bindingId — unbind equipment from a crop
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { unbindEquipment } from '$lib/db/cropEquipment';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

export const DELETE: RequestHandler = (event) => {
  if (!event.params.id || !event.params.bindingId) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  const removed = unbindEquipment(event.params.bindingId);
  if (!removed) throw error(404, 'binding not found');
  return json({ ok: true });
};
