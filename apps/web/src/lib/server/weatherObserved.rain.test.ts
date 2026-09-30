import { like } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { weatherForecastCache } from '$lib/db/schema';
import {
  getObservedRain,
  nearestObservedStations,
  nwsObservationsToRain,
  observedRainKey,
  RAIN_FAILURE_TTL_MS,
  readObservedRainCache,
  type NwsObservationsResponse
} from './weatherObserved';

const H = 3_600_000;
const NOW = Date.UTC(2026, 8, 26, 14, 10);
/** Mobile (KMOB); the other weather tests use KJYO and KBZN, so parallel files never share a key. */
const station = nearestObservedStations(30.69, -88.24, 1)[0];

function obs(iso: string, raw: string) {
  return { properties: { timestamp: iso, rawMessage: raw } };
}

const BODY: NwsObservationsResponse = {
  features: [
    obs('2026-09-26T13:55:00+00:00', 'KJYO 261355Z AUTO 00000KT 10SM RA RMK AO2 P0012'),
    obs('2026-09-26T13:15:00+00:00', 'SPECI KJYO 261315Z AUTO RA RMK AO2 P0004'),
    obs('2026-09-26T12:55:00+00:00', 'KJYO 261255Z AUTO 00000KT 10SM RMK AO2'),
    obs('2026-09-26T11:55:00+00:00', 'KJYO 261155Z AUTO 00000KT 10SM RMK AO2 PNO')
  ]
};

beforeEach(() => {
  db.delete(weatherForecastCache)
    .where(like(weatherForecastCache.cacheKey, `observed%:${station.icao}`))
    .run();
});

describe('observed rain from raw METAR', () => {
  it('decodes routine reports and leaves the gauge-out hour unknown', () => {
    expect(nwsObservationsToRain(BODY, NOW)).toEqual([
      { t: Date.UTC(2026, 8, 26, 11), inches: null },
      { t: Date.UTC(2026, 8, 26, 12), inches: 0 },
      { t: Date.UTC(2026, 8, 26, 13), inches: 0.12 }
    ]);
  });

  it('skips observations with no raw message', () => {
    expect(
      nwsObservationsToRain(
        { features: [{ properties: { timestamp: '2026-09-26T13:55:00Z' } }] },
        NOW
      )
    ).toEqual([]);
  });

  it('caches for an hour and never fetches on a hit', async () => {
    const fetchObs = vi.fn(async () => BODY);
    const first = await getObservedRain(station, NOW, { nwsObservations: fetchObs });
    expect(first.hours).toHaveLength(3);
    expect(readObservedRainCache(station.icao, NOW)).toHaveLength(3);
    await getObservedRain(station, NOW + 10 * 60 * 1000, { nwsObservations: fetchObs });
    expect(fetchObs).toHaveBeenCalledTimes(1);
    await getObservedRain(station, NOW + 2 * H, { nwsObservations: fetchObs });
    expect(fetchObs).toHaveBeenCalledTimes(2);
  });

  it('returns no hours and an error when the feed fails, never throws', async () => {
    const out = await getObservedRain(station, NOW, {
      nwsObservations: async () => {
        throw new Error('down');
      }
    });
    expect(out.hours).toEqual([]);
    expect(out.error).toBe('down');
  });

  it('remembers a failed feed for ten minutes so /today does not wait on it', async () => {
    const down = vi.fn(async () => {
      throw new Error('down');
    });
    await getObservedRain(station, NOW, { nwsObservations: down });
    expect(readObservedRainCache(station.icao, NOW)).toEqual([]);
    const again = await getObservedRain(station, NOW + 5 * 60 * 1000, { nwsObservations: down });
    expect(again.hours).toEqual([]);
    expect(down).toHaveBeenCalledTimes(1);
    expect(readObservedRainCache(station.icao, NOW + RAIN_FAILURE_TTL_MS)).toBeNull();
    await getObservedRain(station, NOW + RAIN_FAILURE_TTL_MS + 1, { nwsObservations: down });
    expect(down).toHaveBeenCalledTimes(2);
  });

  it('keys the cache by station', () => {
    expect(observedRainKey('KJYO')).toBe('observed-rain:KJYO');
  });
});
