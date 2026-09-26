import fc from 'fast-check';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { weatherForecastCache } from '$lib/db/schema';
import { SafeFetchError, type SafeFetchResponse } from '$lib/server/safeFetch';
import epqs from './__fixtures__/epqs.json';
import {
  allowElevationLookup,
  elevationCacheKey,
  elevationFtAt,
  ELEVATION_MAX_BYTES,
  ELEVATION_MISS_TTL_MS,
  ELEVATION_PER_MINUTE,
  ELEVATION_TIMEOUT_MS,
  ELEVATION_TTL_MS,
  epqsUrl,
  fetchElevationFt,
  parseEpqsFeet,
  resetElevationRateLimit,
  type ElevationFetcher
} from './elevation.server';

// Live epqs.nationalmap.gov responses recorded 2026-09-26: Dulles and Boulder
// on land, and the plain-text answers it gives for open water and an outage.

function response(
  status: number,
  text: string,
  opts: { truncated?: boolean; url?: string } = {}
): SafeFetchResponse {
  return {
    url: opts.url ?? 'https://epqs.nationalmap.gov/v1/json',
    status,
    contentType: 'application/json',
    readText: async () => ({ text, truncated: opts.truncated ?? false }),
    cancel: vi.fn()
  };
}

function fetcherReturning(
  res: SafeFetchResponse | Error
): ReturnType<typeof vi.fn> & ElevationFetcher {
  return vi.fn(async () => {
    if (res instanceof Error) throw res;
    return res;
  }) as ReturnType<typeof vi.fn> & ElevationFetcher;
}

let seq = 0;
function freshLat(): number {
  seq += 1;
  return 20 + seq / 997 + Math.random() / 1e6;
}

describe('epqsUrl', () => {
  it('asks the USGS point service for feet in WGS84', () => {
    const url = new URL(epqsUrl(38.9408, -77.4636));
    expect(url.origin + url.pathname).toBe('https://epqs.nationalmap.gov/v1/json');
    expect(url.searchParams.get('x')).toBe('-77.46360');
    expect(url.searchParams.get('y')).toBe('38.94080');
    expect(url.searchParams.get('wkid')).toBe('4326');
    expect(url.searchParams.get('units')).toBe('Feet');
  });

  it('always stays on the pinned host', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (lat, lon) => {
          expect(new URL(epqsUrl(lat, lon)).hostname).toBe('epqs.nationalmap.gov');
        }
      )
    );
  });
});

describe('parseEpqsFeet', () => {
  it('reads the recorded land answers', () => {
    expect(parseEpqsFeet(epqs.dulles)).toBeCloseTo(289.44, 1);
    expect(parseEpqsFeet(epqs.boulder)).toBeCloseTo(5319.1, 1);
  });

  it('treats open water, outages, sentinels and junk as unknown', () => {
    expect(parseEpqsFeet(epqs.ocean)).toBeNull();
    expect(parseEpqsFeet(epqs.failed)).toBeNull();
    expect(parseEpqsFeet('{"value":-1000000}')).toBeNull();
    expect(parseEpqsFeet('{"value":"-1000000"}')).toBeNull();
    expect(parseEpqsFeet('{"value":null}')).toBeNull();
    expect(parseEpqsFeet('null')).toBeNull();
    expect(parseEpqsFeet('')).toBeNull();
  });

  it('accepts a numeric string value', () => {
    expect(parseEpqsFeet('{"value":"812.5"}')).toBe(812.5);
  });
});

describe('fetchElevationFt', () => {
  it('fetches with no redirects, a timeout and a size cap', async () => {
    const fetcher = fetcherReturning(response(200, epqs.dulles));
    expect(await fetchElevationFt(38.9408, -77.4636, fetcher)).toBeCloseTo(289.44, 1);
    const [url, opts] = fetcher.mock.calls[0];
    expect(new URL(url as string).hostname).toBe('epqs.nationalmap.gov');
    expect(opts).toMatchObject({
      maxRedirects: 0,
      timeoutMs: ELEVATION_TIMEOUT_MS,
      maxBytes: ELEVATION_MAX_BYTES
    });
  });

  it('gives null, never throws, on any failure', async () => {
    const cases: (SafeFetchResponse | Error)[] = [
      response(500, epqs.dulles),
      response(200, epqs.ocean),
      response(200, epqs.dulles, { truncated: true }),
      response(200, epqs.dulles, { url: 'https://evil.example/v1/json' }),
      new SafeFetchError('timeout', 'Request timed out'),
      new Error('boom')
    ];
    for (const c of cases) {
      expect(await fetchElevationFt(38.9, -77.4, fetcherReturning(c))).toBeNull();
    }
  });

  it('skips the request for an invalid point', async () => {
    const fetcher = fetcherReturning(response(200, epqs.dulles));
    expect(await fetchElevationFt(NaN, -77, fetcher)).toBeNull();
    expect(await fetchElevationFt(95, -77, fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('elevationFtAt', () => {
  function cached(lat: number, lon: number) {
    return db
      .select()
      .from(weatherForecastCache)
      .where(eq(weatherForecastCache.cacheKey, elevationCacheKey(lat, lon)))
      .get();
  }

  it('caches a hit for a year and serves it without fetching again', async () => {
    const lat = freshLat();
    const now = Date.UTC(2026, 8, 26);
    const fetcher = fetcherReturning(response(200, epqs.boulder));
    expect(await elevationFtAt(lat, -105.27, { fetcher, now })).toBeCloseTo(5319.1, 1);
    const row = cached(lat, -105.27)!;
    expect(row.expiresAt.getTime()).toBe(now + ELEVATION_TTL_MS);
    const again = fetcherReturning(new Error('should not be called'));
    expect(await elevationFtAt(lat, -105.27, { fetcher: again, now: now + 1000 })).toBeCloseTo(
      5319.1,
      1
    );
    expect(again).not.toHaveBeenCalled();
  });

  it('caches a miss briefly, then tries again', async () => {
    const lat = freshLat();
    const now = Date.UTC(2026, 8, 26);
    const miss = fetcherReturning(response(200, epqs.failed));
    expect(await elevationFtAt(lat, -77, { fetcher: miss, now })).toBeNull();
    expect(cached(lat, -77)!.expiresAt.getTime()).toBe(now + ELEVATION_MISS_TTL_MS);
    const stillCached = fetcherReturning(response(200, epqs.dulles));
    expect(await elevationFtAt(lat, -77, { fetcher: stillCached, now: now + 1000 })).toBeNull();
    expect(stillCached).not.toHaveBeenCalled();
    const later = fetcherReturning(response(200, epqs.dulles));
    expect(
      await elevationFtAt(lat, -77, { fetcher: later, now: now + ELEVATION_MISS_TTL_MS + 1 })
    ).toBeCloseTo(289.44, 1);
  });

  it('shares one request between concurrent callers', async () => {
    const lat = freshLat();
    const fetcher = fetcherReturning(response(200, epqs.dulles));
    const [a, b] = await Promise.all([
      elevationFtAt(lat, -77, { fetcher }),
      elevationFtAt(lat, -77, { fetcher })
    ]);
    expect(a).toBe(b);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('allowElevationLookup', () => {
  beforeEach(() => resetElevationRateLimit());

  it('allows a burst per user, then refuses until the window passes', () => {
    const now = 1_000_000;
    for (let i = 0; i < ELEVATION_PER_MINUTE; i++)
      expect(allowElevationLookup('u1', now)).toBe(true);
    expect(allowElevationLookup('u1', now)).toBe(false);
    expect(allowElevationLookup('u2', now)).toBe(true);
    expect(allowElevationLookup('u1', now + 60_001)).toBe(true);
  });
});
