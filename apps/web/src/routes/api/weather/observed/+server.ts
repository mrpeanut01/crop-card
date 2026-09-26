/**
 * GET /api/weather/observed?blockId=…&from=<ms epoch>
 *
 * Observed hourly weather since `from` at the NOAA station nearest the block
 * (NCEI GHCNh + NWS observations). Advisory: a feed failure or no nearby
 * station returns 200 with `provenance: 'fallback'` and no hours.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { currentUser } from '$lib/server/auth';
import { resolveWeatherLocation } from '$lib/server/weatherHourly';
import {
  getObservedHours,
  OBSERVED_MAX_SPAN_DAYS,
  stationLabel
} from '$lib/server/weatherObserved';

const DAY_MS = 24 * 60 * 60 * 1000;

export const GET: RequestHandler = async (event) => {
  if (!currentUser(event)) {
    return json({ error: 'authentication required' }, { status: 401 });
  }
  const now = Date.now();
  const from = Number(event.url.searchParams.get('from'));
  if (!Number.isFinite(from) || from > now || from < now - OBSERVED_MAX_SPAN_DAYS * DAY_MS) {
    return json(
      { error: `from must be a ms timestamp within the last ${OBSERVED_MAX_SPAN_DAYS} days` },
      { status: 400 }
    );
  }
  const location = resolveWeatherLocation(event.url.searchParams.get('blockId'));
  if (!location) return json({ error: 'block not found' }, { status: 404 });

  const observed = await getObservedHours(location.lat, location.lon, from, now);
  return json(
    {
      hours: observed.hours,
      provenance: observed.provenance,
      station: observed.station
        ? { ...observed.station, label: stationLabel(observed.station) }
        : null,
      sources: observed.sources,
      latestMs: observed.latestMs,
      location,
      error: observed.error
    },
    { headers: { 'cache-control': 'private, max-age=900' } }
  );
};
