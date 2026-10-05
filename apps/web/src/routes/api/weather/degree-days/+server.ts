/**
 * GET /api/weather/degree-days?model=<id>&year=<yyyy>
 *
 * Degree days per pest model for the active Owner: station, method, base,
 * cutoff, biofix with provenance, lower-bound total, missing days, the date
 * the count runs through, and the stage. Any member of the farm. Pure read;
 * no station or no location is a 200 with a plain message.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { currentUser } from '$lib/server/auth';
import { loadDegreeDays } from '$lib/server/degreeDays.server';
import { degreeDaysQuerySchema } from '$lib/ipm/apiSchemas';
import { t } from '$lib/i18n';

export const _querySchema = degreeDaysQuerySchema;

export const GET: RequestHandler = async (event) => {
  if (!currentUser(event))
    return json({ error: t(event.locals?.locale, 'api.errB.authRequired') }, { status: 401 });
  const parsed = degreeDaysQuerySchema.safeParse({
    model: event.url.searchParams.get('model') ?? undefined,
    year: event.url.searchParams.get('year') ?? undefined
  });
  if (!parsed.success) {
    return json(
      {
        error: t(event.locals?.locale, 'stockui.api.invalidRequest'),
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      },
      { status: 400 }
    );
  }
  const now = Date.now();
  const thisYear = new Date(now).getFullYear();
  const year = parsed.data.year ?? thisYear;
  if (year > thisYear)
    return json({ error: t(event.locals?.locale, 'api.errB.yearFuture') }, { status: 400 });
  const result = await loadDegreeDays({
    year,
    modelId: parsed.data.model,
    nowMs: now,
    locale: event.locals?.locale
  });
  if (parsed.data.model && result.models.length === 0) {
    return json({ error: t(event.locals?.locale, 'api.errB.pestModelNotFound') }, { status: 404 });
  }
  return json(result, { headers: { 'cache-control': 'private, max-age=300' } });
};
