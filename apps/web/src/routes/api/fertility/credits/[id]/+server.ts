/** DELETE /api/fertility/credits/:id */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { deleteFertilityCredit } from '$lib/db/admin';
import { requireOwner } from '$lib/server/auth';

export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  if (!event.params.id) throw error(400, 'id required');
  return json(deleteFertilityCredit(event.params.id));
};
