/**
 * DELETE /api/stock/:id/lots/:lotId — drop a single lot + its movements.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { deleteStockLotCascade } from '$lib/db/admin';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

export const DELETE: RequestHandler = (event) => {
  if (!event.params.lotId) throw error(400, 'lotId required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  return json(deleteStockLotCascade(event.params.lotId));
};
