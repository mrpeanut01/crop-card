import { t } from '$lib/i18n';
/**
 * DELETE /api/harvest/records/:id?force=true — remove a harvest event row.
 *
 * FR-09 (#308): harvest records carry the same 48-hour immutability lock
 * as spray records. The default DELETE refuses a locked row (422); owners
 * can pass `?force=true` to override, which writes a #329 tombstone before
 * the row is destroyed. A harvest with dispositions answers 409
 * `HARVEST_HAS_DISPOSITIONS` until they are removed (Phase 33B, B-30).
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { deleteHarvestEvent, RecordLockedError } from '$lib/db/admin';
import { getHarvestEvent } from '$lib/db/harvestEvents';
import { countDispositionsForHarvest } from '$lib/db/harvestDispositions';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { tryGuardedHoldWrite } from '$lib/server/holdGuard';

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
    return json({ error: t(event.locals?.locale, 'api.err.forceDeleteOwner') }, { status: 403 });
  }
  const existing = getHarvestEvent(event.params.id);
  if (!existing) throw error(404, t(event.locals?.locale, 'api.err.harvestNotFound'));
  if (countDispositionsForHarvest(existing.id) > 0) {
    return json(
      {
        error: 'HARVEST_HAS_DISPOSITIONS',
        message: t(event.locals?.locale, 'api.err.removeDispositionsFirst')
      },
      { status: 409 }
    );
  }
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
