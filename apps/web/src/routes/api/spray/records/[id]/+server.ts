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
import { farmTimeZone } from '$lib/db/userProfile';
import { applicationHoldsGrazing } from '$lib/server/areaGrazing';
import { interactiveOwnerRefusal, isInteractiveOwner } from '$lib/server/interactiveOwner';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';
import { recordedAtOf } from '$lib/db/holdParams';
import { t } from '$lib/i18n';

export const GET: RequestHandler = ({ params, locals }) => {
  if (!params.id) throw error(400, t(locals?.locale, 'stockui.api.idRequired'));
  const e = getSprayEvent(params.id);
  if (!e) throw error(404, t(locals?.locale, 'api.errB.sprayRecordNotFound'));
  return json({ event: e });
};

export const DELETE: RequestHandler = async (event) => {
  if (!event.params.id) throw error(400, t(event.locals?.locale, 'stockui.api.idRequired'));
  const auth = currentUser(event);
  if (auth && !canMutate(auth.role)) {
    return json(
      { error: t(event.locals?.locale, 'stockui.api.inspectorReadOnly') },
      { status: 403 }
    );
  }
  const force = event.url.searchParams.get('force') === 'true';
  if (force && auth?.role !== 'owner') {
    return json({ error: t(event.locals?.locale, 'api.errB.forceDeleteOwner') }, { status: 403 });
  }
  const existing = getSprayEvent(event.params.id);
  if (!existing) throw error(404, t(event.locals?.locale, 'api.errB.sprayRecordNotFound'));
  const reason = event.url.searchParams.get('reason') ?? undefined;
  const neverApplied = event.url.searchParams.get('neverApplied') === 'true';
  const holds = await applicationHoldsGrazing(`spray:${event.params.id}`, farmTimeZone());
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
        deleteSprayEvent(id, {
          force: force || neverApplied,
          deletedBy: auth?.id,
          reason,
          tombstone: true,
          neverApplied
        }),
      neverApplied
        ? {
            void: {
              recordKind: 'spray',
              recordId: id,
              createdAtMs: recordedAtOf('spray', id),
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
