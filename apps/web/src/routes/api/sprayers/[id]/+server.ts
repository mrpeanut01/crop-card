/**
 * DELETE /api/sprayers/:id — legacy sprayer row + cascade through any
 * spray events recorded on it (and their stock_movements).
 *
 * The new equipment table is the long-term home for sprayers; this
 * endpoint exists so testers can clear out stale legacy rows during the
 * migration window.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { deleteSprayerCascade } from '$lib/db/admin';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

export const DELETE: RequestHandler = (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  return json(deleteSprayerCascade(event.params.id));
};
