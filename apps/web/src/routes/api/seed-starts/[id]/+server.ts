import { json, type RequestHandler } from '@sveltejs/kit';
import { MAX_FUTURE_SKEW_MS } from '$lib/animals/model';
import { getSeedStart, updateSeedStart } from '$lib/db/seedStarts';
import { seedStartPatchSchema } from '$lib/seedStart/apiSchemas';
import { parseBody } from '$lib/server/animals';
import { requireOwner, requireUser } from '$lib/server/auth';
import { assertField, assertStockLot, rejectForeignRefs } from '$lib/server/foreignRefs';
import { t } from '$lib/i18n';

export const _requestSchema = seedStartPatchSchema;

export const GET: RequestHandler = (event) => {
  requireUser(event);
  const tray = getSeedStart(event.params.id ?? '');
  if (!tray)
    return json({ error: t(event.locals?.locale, 'stockui.api.notFound') }, { status: 404 });
  return json({ tray });
};

/** PATCH /api/seed-starts/[id]. The owner edits a tray (online only). */
export const PATCH: RequestHandler = async (event) => {
  requireOwner(event);
  const id = event.params.id ?? '';
  if (!getSeedStart(id))
    return json({ error: t(event.locals?.locale, 'stockui.api.notFound') }, { status: 404 });
  const body = await parseBody(event.request, seedStartPatchSchema);
  if (!body.ok) return body.response;
  const input = body.data;
  const foreign = rejectForeignRefs(
    assertField('locationAreaId', input.locationAreaId),
    assertStockLot('stockLotId', input.stockLotId)
  );
  if (foreign) return foreign;
  if (input.sownAt !== undefined && input.sownAt > Date.now() + MAX_FUTURE_SKEW_MS) {
    return json(
      { error: t(event.locals?.locale, 'api.errB.traySownFuture'), code: 'IN_THE_FUTURE' },
      { status: 400 }
    );
  }
  return json({ tray: updateSeedStart(id, input) });
};
