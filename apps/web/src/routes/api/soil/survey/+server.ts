/**
 * GET /api/soil/survey?lat=&lon=
 *
 * The USDA NRCS soil survey at a map point, for any signed-in role. Reference
 * data for display only. `no-data` (the survey has nothing there) and
 * `unavailable` (the service could not be reached) are both 200.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { currentUser } from '$lib/server/auth';
import { allowSoilLookup, soilSurveyAt } from '$lib/server/soil/ssurgo.server';
import { soilSurveyQuerySchema } from '$lib/soil/apiSchemas';

export const _requestSchema = soilSurveyQuerySchema;

export const GET: RequestHandler = async (event) => {
  const locale = event.locals?.locale;
  const user = currentUser(event);
  if (!user) return json({ error: t(locale, 'api.err.authRequired') }, { status: 401 });
  const query = soilSurveyQuerySchema.safeParse({
    lat: event.url.searchParams.get('lat') ?? '',
    lon: event.url.searchParams.get('lon') ?? ''
  });
  if (!query.success) {
    return json({ error: t(locale, 'api.err.latLonInvalid') }, { status: 400 });
  }
  if (!allowSoilLookup(user.id)) {
    return json({ error: t(locale, 'api.err.tooManyLookups') }, { status: 429 });
  }
  const lookup = await soilSurveyAt(query.data.lat, query.data.lon);
  return json(lookup, {
    headers: {
      'cache-control': lookup.status === 'unavailable' ? 'no-store' : 'private, max-age=3600'
    }
  });
};
