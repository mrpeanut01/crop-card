import { json, type RequestHandler } from '@sveltejs/kit';
import { MAX_FUTURE_SKEW_MS } from '$lib/animals/model';
import { createSeedStart, listSeedStartsForCrops } from '$lib/db/seedStarts';
import { seedStartCreateSchema } from '$lib/seedStart/apiSchemas';
import { parseBody } from '$lib/server/animals';
import { requireOwner, requireUser } from '$lib/server/auth';
import { withClientRecordId } from '$lib/server/clientRecordId';
import {
  assertCrop,
  assertField,
  assertStockLot,
  rejectForeignRefs
} from '$lib/server/foreignRefs';
import { writeRecord } from '$lib/server/recordWrite';
import { t } from '$lib/i18n';

export const _requestSchema = seedStartCreateSchema;

/** GET /api/seed-starts?cropId=… lists a planting's trays. */
export const GET: RequestHandler = (event) => {
  requireUser(event);
  const cropId = event.url.searchParams.get('cropId');
  if (!cropId)
    return json({ error: t(event.locals?.locale, 'api.errB.cropIdRequired') }, { status: 400 });
  return json({ trays: listSeedStartsForCrops([cropId]) });
};

/** POST /api/seed-starts. The owner logs a seed-starting tray for a
 *  planting (Phase 32E, E1-14). Replayable. Never gated by SEASON_CLOSED. */
export const POST: RequestHandler = withClientRecordId(async (event) => {
  const user = requireOwner(event);
  const body = await parseBody(event.request, seedStartCreateSchema);
  if (!body.ok) return body.response;
  const input = body.data;
  const foreign = rejectForeignRefs(
    assertCrop('cropId', input.cropId),
    assertField('locationAreaId', input.locationAreaId),
    assertStockLot('stockLotId', input.stockLotId)
  );
  if (foreign) return foreign;
  if (input.sownAt > Date.now() + MAX_FUTURE_SKEW_MS) {
    return json(
      { error: t(event.locals?.locale, 'api.errB.traySownFuture'), code: 'IN_THE_FUTURE' },
      { status: 400 }
    );
  }
  const tray = writeRecord(event, () => createSeedStart({ ...input, performedById: user.id }));
  return json({ tray }, { status: 201 });
});
