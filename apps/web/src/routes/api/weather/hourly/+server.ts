/**
 * GET /api/weather/hourly?blockId=…[&rainfastHours=…] — Phase 29 (#132).
 *
 * Hourly NWS gridpoint forecast for a block (centroid → farm fallback) plus
 * the derived leaf-wet / rain / dry-window summary. Weather is advisory:
 * a feed failure returns 200 with `provenance: 'fallback'` and no hours so
 * the spray UI can say "Weather unavailable" instead of blocking.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { currentUser } from '$lib/server/auth';
import { getHourlyForecastSafely, resolveWeatherLocation } from '$lib/server/weatherHourly';
import { deriveHourly } from '$lib/weather/leafWet';

export const GET: RequestHandler = async (event) => {
  if (!currentUser(event)) {
    return json({ error: 'authentication required' }, { status: 401 });
  }
  const blockId = event.url.searchParams.get('blockId');
  const location = resolveWeatherLocation(blockId);
  if (!location) return json({ error: 'block not found' }, { status: 404 });

  const rawRainfast = event.url.searchParams.get('rainfastHours');
  const rainfastHours = rawRainfast === null ? undefined : Number(rawRainfast);
  if (
    rainfastHours !== undefined &&
    (!Number.isFinite(rainfastHours) || rainfastHours <= 0 || rainfastHours > 72)
  ) {
    return json({ error: 'rainfastHours must be in (0, 72]' }, { status: 400 });
  }

  const now = Date.now();
  const forecast = await getHourlyForecastSafely(location.lat, location.lon, now);
  return json(
    {
      hours: forecast.hours,
      derived: deriveHourly(forecast.hours, forecast.provenance, { nowMs: now, rainfastHours }),
      provenance: forecast.provenance,
      fetchedAt: forecast.fetchedAt,
      location,
      error: forecast.error
    },
    { headers: { 'cache-control': 'private, max-age=300' } }
  );
};
