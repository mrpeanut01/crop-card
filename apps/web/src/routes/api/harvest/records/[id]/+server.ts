/**
 * DELETE /api/harvest/records/:id?force=true — remove a harvest event row.
 *
 * FR-09 (#308): harvest records carry the same 48-hour immutability lock
 * as spray records. The default DELETE refuses a locked row (422); owners
 * can pass `?force=true` to override, which writes a #329 tombstone before
 * the row is destroyed.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { deleteHarvestEvent, RecordLockedError } from '$lib/db/admin';
import { getHarvestEvent } from '$lib/db/harvestEvents';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';

export const DELETE: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, 'id required');
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json({ error: 'inspector role is read-only' }, { status: 403 });
  }
  const force = event.url.searchParams.get('force') === 'true';
  if (force && auth?.role !== 'owner') {
    return json({ error: 'force-delete of locked records requires owner role' }, { status: 403 });
  }
  const existing = getHarvestEvent(event.params.id);
  if (!existing) throw error(404, 'harvest record not found');
  const reason = event.url.searchParams.get('reason') ?? undefined;
  try {
    const id = event.params.id;
    const guarded = await tryGuardedHoldWrite(event, auth, () =>
      deleteHarvestEvent(id, { force, deletedBy: auth?.id, reason })
    );
    if (!guarded.ok) return guarded.response;
    return json(guarded.value);
  } catch (e) {
    if (e instanceof RecordLockedError) {
      return json({ error: e.message }, { status: 422 });
    }
    throw e;
  }
};
