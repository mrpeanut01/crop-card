/**
 * GET /api/garden/harvest-schedule?areaId=: what the herbs will give and
 * when, against the garden brief's goals (Phase 37C). Every signed-in role
 * reads it; it writes nothing. No yield numbers.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { harvestScheduleQuerySchema } from '$lib/garden/harvestScheduleApi';
import { getField } from '$lib/db/fields';
import { currentUser } from '$lib/server/auth';
import { harvestScheduleResponse } from '$lib/server/pantry.server';
import { t } from '$lib/i18n';

export const _querySchema = harvestScheduleQuerySchema;

export const GET: RequestHandler = async (event) => {
  const locale = event.locals?.locale;
  if (!currentUser(event)) {
    return json({ error: t(locale, 'api.errB.authRequired') }, { status: 401 });
  }
  const parsed = harvestScheduleQuerySchema.safeParse({
    areaId: event.url.searchParams.get('areaId') ?? undefined
  });
  if (!parsed.success) {
    return json({ error: t(locale, 'herbsc.err.badQuery') }, { status: 400 });
  }
  const areaId = parsed.data.areaId;
  if (areaId && !getField(areaId)) {
    return json({ error: t(locale, 'herbsc.err.noArea') }, { status: 404 });
  }
  const body = await harvestScheduleResponse(
    areaId ? { areaId, locale } : { herbsOnly: true, locale }
  );
  return json(body, { headers: { 'cache-control': 'no-store' } });
};
