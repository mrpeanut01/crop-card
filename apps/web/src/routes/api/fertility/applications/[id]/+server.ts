/**
 * DELETE /api/fertility/applications/:id — remove the application + any
 * stock_movements that point at it.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { deleteFertilityApplication } from '$lib/db/admin';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

export const DELETE: RequestHandler = (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  return json(deleteFertilityApplication(event.params.id));
};
