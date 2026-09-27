/**
 * DELETE /api/insecticide/:id?force=true — remove the event row + any
 * stock_movements that point at it.
 *
 * FR-09 (#308): insecticide records carry the same 48-hour immutability
 * lock as spray records. The default DELETE refuses a locked row (422);
 * owners can pass `?force=true` to override, which writes a #329 tombstone
 * before the row is destroyed.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { deleteInsecticideEvent, RecordLockedError } from '$lib/db/admin';
import { getInsecticideEvent } from '$lib/db/insecticideEvents';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { prefsFor } from '$lib/db/userProfile';
import { applicationHoldsGrazing } from '$lib/server/areaGrazing';
import { interactiveOwnerRefusal, isInteractiveOwner } from '$lib/server/interactiveOwner';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';
import { recordedAtOf } from '$lib/db/holdParams';

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
  const existing = getInsecticideEvent(event.params.id);
  if (!existing) throw error(404, 'insecticide record not found');
  const reason = event.url.searchParams.get('reason') ?? undefined;
  const neverApplied = event.url.searchParams.get('neverApplied') === 'true';
  const holds = await applicationHoldsGrazing(
    `insecticide:${event.params.id}`,
    prefsFor(auth?.id).timeZone
  );
  if ((holds || neverApplied) && auth?.role !== 'owner') {
    return json(
      {
        error:
          'This application still holds grazing or hay on its Area. Only the owner can remove it. Ask the owner.',
        code: 'APPLICATION_HAS_GRAZING_HOLD'
      },
      { status: 403 }
    );
  }
  if (neverApplied && auth && !isInteractiveOwner(event, auth)) return interactiveOwnerRefusal();
  const id = event.params.id;
  try {
    const guarded = await tryGuardedHoldWrite(
      event,
      auth,
      () =>
        deleteInsecticideEvent(id, {
          force: force || neverApplied,
          deletedBy: auth?.id,
          reason,
          tombstone: true,
          neverApplied
        }),
      neverApplied
        ? {
            void: {
              recordKind: 'insecticide',
              recordId: id,
              createdAtMs: recordedAtOf('insecticide', id) ?? existing.occurredAt,
              reason: reason ?? 'Never applied',
              confirmShorten: event.url.searchParams.get('confirmShorten')
            }
          }
        : {}
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
