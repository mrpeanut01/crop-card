/**
 * GET /api/soil/areas/[id]
 *
 * The USDA NRCS soil survey for one of the farm's Areas, at the centre of
 * its drawn outline, or at the farm's saved location (`approximate`) when
 * the Area is not drawn. Any signed-in role. Another Owner's Area is 404.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { currentUser } from '$lib/server/auth';
import { allowSoilLookup, soilSurveyForArea } from '$lib/server/soil/ssurgo.server';
import type { SoilAreaResponse } from '$lib/soil/types';

export const GET: RequestHandler = async (event) => {
  const locale = event.locals?.locale;
  const user = currentUser(event);
  if (!user) return json({ error: t(locale, 'api.err.authRequired') }, { status: 401 });
  if (!allowSoilLookup(user.id)) {
    return json({ error: t(locale, 'api.err.tooManyLookups') }, { status: 429 });
  }
  const found = await soilSurveyForArea(event.params.id ?? '');
  if (found === undefined) {
    return json({ error: t(locale, 'orchardui.err.areaNotFound') }, { status: 404 });
  }
  const body: SoilAreaResponse =
    found === null
      ? { located: false }
      : { located: true, approximate: found.approximate, lookup: found.lookup };
  const fresh = found !== null && !found.approximate && found.lookup.status !== 'unavailable';
  return json(body, {
    headers: { 'cache-control': fresh ? 'private, max-age=3600' : 'no-store' }
  });
};
