/** DELETE /api/fertility/soil-tests/:id */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { deleteSoilTest } from '$lib/db/admin';
import { requireOwner } from '$lib/server/auth';

export const DELETE: RequestHandler = (event) => {
  requireOwner(event);
  if (!event.params.id) throw error(400, 'id required');
  return json(deleteSoilTest(event.params.id));
};
