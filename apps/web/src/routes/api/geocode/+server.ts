import { json, type RequestHandler } from '@sveltejs/kit';
import { currentUser } from '$lib/server/auth';
import { allowGeocode, geocodeAddress, normalizeGeocodeQuery } from '$lib/server/geocode';

export const GET: RequestHandler = async (event) => {
  const user = currentUser(event);
  if (!user) return json({ error: 'authentication required' }, { status: 401 });
  const query = normalizeGeocodeQuery(event.url.searchParams.get('q'));
  if (!query) return json({ error: 'q must be 3-200 characters' }, { status: 400 });
  if (!allowGeocode(user.id)) {
    return json({ error: 'too many lookups; try again in a minute' }, { status: 429 });
  }
  const matches = await geocodeAddress(query);
  return json({ matches }, { headers: { 'cache-control': 'private, max-age=300' } });
};
