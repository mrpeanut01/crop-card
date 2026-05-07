/**
 * GET    /api/spray/records/:id
 * DELETE /api/spray/records/:id?force=true
 *
 * Spray records carry the FR-09 48-hour immutability lock. The default
 * DELETE refuses if the row is already locked; owners can pass
 * `?force=true` to override. Cascade removes any stock_movements that
 * reference this spray.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { deleteSprayEvent, RecordLockedError } from '$lib/db/admin';
import { getSprayEvent } from '$lib/db/sprayEvents';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';

export const GET: RequestHandler = ({ params }) => {
  if (!params.id) throw error(400, 'id required');
  const e = getSprayEvent(params.id);
  if (!e) throw error(404, 'spray record not found');
  return json({ event: e });
};

export const DELETE: RequestHandler = (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  const force = event.url.searchParams.get('force') === 'true';
  if (force && auth?.role !== 'owner') {
    return json({ error: 'force-delete of locked records requires owner role' }, { status: 403 });
  }
  const existing = getSprayEvent(event.params.id);
  if (!existing) throw error(404, 'spray record not found');
  try {
    return json(deleteSprayEvent(event.params.id, { force }));
  } catch (e) {
    if (e instanceof RecordLockedError) {
      return json({ error: e.message }, { status: 422 });
    }
    throw e;
  }
};
