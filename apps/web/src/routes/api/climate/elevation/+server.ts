import { json, type RequestHandler } from '@sveltejs/kit';
import { currentUser } from '$lib/server/auth';
import { allowElevationLookup, elevationFtAt } from '$lib/climate/elevation.server';

function coord(raw: string | null, limit: number): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/** Ground elevation for the hardiness-zone station guard. `elevationFt: null` means unknown. */
export const GET: RequestHandler = async (event) => {
  const user = currentUser(event);
  if (!user) return json({ error: 'authentication required' }, { status: 401 });
  const lat = coord(event.url.searchParams.get('lat'), 90);
  const lon = coord(event.url.searchParams.get('lon'), 180);
  if (lat === null || lon === null) {
    return json({ error: 'lat and lon must be valid coordinates' }, { status: 400 });
  }
  if (!allowElevationLookup(user.id)) {
    return json({ error: 'too many lookups; try again in a minute' }, { status: 429 });
  }
  const elevationFt = await elevationFtAt(lat, lon);
  return json(
    { elevationFt, source: elevationFt === null ? null : 'USGS 3DEP' },
    { headers: { 'cache-control': 'private, max-age=3600' } }
  );
};
