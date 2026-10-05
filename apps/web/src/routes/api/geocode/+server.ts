import { t } from '$lib/i18n';
import { json, type RequestHandler } from '@sveltejs/kit';
import { currentUser } from '$lib/server/auth';
import { allowGeocode, geocodeAddress, normalizeGeocodeQuery } from '$lib/server/geocode';

export const GET: RequestHandler = async (event) => {
  const user = currentUser(event);
  if (!user)
    return json({ error: t(event.locals?.locale, 'api.err.authRequired') }, { status: 401 });
  const query = normalizeGeocodeQuery(event.url.searchParams.get('q'));
  if (!query)
    return json({ error: t(event.locals?.locale, 'api.err.queryLength') }, { status: 400 });
  if (!allowGeocode(user.id)) {
    return json({ error: t(event.locals?.locale, 'api.err.tooManyLookups') }, { status: 429 });
  }
  const matches = await geocodeAddress(query);
  return json({ matches }, { headers: { 'cache-control': 'private, max-age=300' } });
};
