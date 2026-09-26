/**
 * GET /api/hay/forecast?blockId=X
 *
 * Pulls the NOAA NWS 7-day forecast, cached server-side (1 hr TTL) per FR-22
 * and the NWS rate-limit guidance.
 *
 * Explicit `lat` + `lon` query params win. Otherwise the location is the
 * block's centroid, then any mapped block, then the saved farm location.
 * With none of those the gate has no honest forecast, so it returns 400.
 *
 * Inspector role can read; no mutation here.
 */

import { error, json, type RequestHandler } from '@sveltejs/kit';
import { getForecast, WeatherFetchError } from '$lib/server/weather';
import { resolveWeatherLocation } from '$lib/server/weatherHourly';

function coord(raw: string | null): number {
  return raw === null || raw.trim() === '' ? NaN : Number(raw);
}

export const GET: RequestHandler = async ({ url }) => {
  const blockId = url.searchParams.get('blockId');
  let lat = coord(url.searchParams.get('lat'));
  let lon = coord(url.searchParams.get('lon'));
  let source: string = 'explicit';

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const location = resolveWeatherLocation(blockId);
    if (!location) throw error(404, 'block not found');
    if (location.source === 'farm-default') {
      return json(
        {
          error:
            'no mapped block and no farm location; set one on /settings/farm or pass &lat=&lon=',
          blockId
        },
        { status: 400 }
      );
    }
    ({ lat, lon, source } = location);
  }

  try {
    const forecast = await getForecast(lat, lon);
    return json({ forecast, lat, lon, source });
  } catch (err) {
    if (err instanceof WeatherFetchError) {
      return json({ error: 'NWS upstream failed', detail: err.message }, { status: 502 });
    }
    throw err;
  }
};
