import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBlock } from '$lib/db/blocks';
import { db } from '$lib/db/client';
import { owners, weatherForecastCache } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { LOUDOUN_DEFAULT_LAT_LON } from '$lib/schedule/constants';
import { deriveHourly, HOUR_MS } from '$lib/weather/leafWet';
import grid from './__fixtures__/nws-gridpoint-lwx.json';
import gridMob from './__fixtures__/nws-gridpoint-mob.json';
import gridBzn from './__fixtures__/nws-gridpoint-tfx-bozeman.json';
import points from './__fixtures__/nws-points-lwx.json';
import pointsMob from './__fixtures__/nws-points-mob.json';
import pointsBzn from './__fixtures__/nws-points-tfx-bozeman.json';
import { WeatherFetchError } from './weather';
import {
  expandValidTime,
  getHourlyForecast,
  getHourlyForecastSafely,
  gridpointToHourly,
  hourlyCacheKey,
  HOURLY_CACHE_TTL_MS,
  parseIsoDurationHours,
  resolveWeatherLocation,
  type NwsGridpointResponse
} from './weatherHourly';

// Live api.weather.gov responses recorded 2026-09-26, trimmed to five days.
const FIXTURE_START = Date.UTC(2026, 8, 26, 5);
const FIXTURE_HOURS = 123;
let latSeq = 0;
function freshLat(): number {
  latSeq += 1;
  return 10 + latSeq / 1000 + Math.random() / 1e6;
}

function mockNws(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string) => {
    const body = url.includes('/points/') ? points : grid;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastCompleteHour(hours: ReturnType<typeof gridpointToHourly>): number {
  return hours.findLastIndex((h) => h.tempF !== null && h.rhPct !== null && h.windMph !== null);
}

describe('parseIsoDurationHours', () => {
  it.each([
    ['PT1H', 1],
    ['PT3H', 3],
    ['P1D', 24],
    ['P1DT6H', 30],
    ['P7DT12H', 180],
    ['PT30M', 1],
    ['P1W', 168]
  ])('%s → %i', (d, h) => {
    expect(parseIsoDurationHours(d)).toBe(h);
  });
  it.each(['', 'P', 'PT', 'PT0H', '3H', 'garbage'])('rejects %j', (d) => {
    expect(parseIsoDurationHours(d)).toBeNull();
  });
});

describe('expandValidTime', () => {
  it('expands a 3-hour interval into three hourly starts', () => {
    const t = Date.UTC(2026, 8, 25, 14);
    expect(expandValidTime('2026-09-25T14:00:00+00:00/PT3H')).toEqual([
      t,
      t + HOUR_MS,
      t + 2 * HOUR_MS
    ]);
  });
  it('honors a non-UTC offset', () => {
    expect(expandValidTime('2026-09-25T10:00:00-04:00/PT1H')).toEqual([Date.UTC(2026, 8, 25, 14)]);
  });
  it('returns [] on malformed input', () => {
    expect(expandValidTime('2026-09-25T14:00:00+00:00')).toEqual([]);
    expect(expandValidTime('nope/PT1H')).toEqual([]);
  });
});

describe('gridpointToHourly', () => {
  it('expands the recorded fixture into one point per hour with converted units', () => {
    const hours = gridpointToHourly(grid as NwsGridpointResponse);
    expect(hours).toHaveLength(FIXTURE_HOURS);
    expect(hours[0].t).toBe(FIXTURE_START);
    for (let i = 1; i < hours.length; i++) expect(hours[i].t - hours[i - 1].t).toBe(HOUR_MS);
    // NWS series end at different times, so the last few hours legitimately
    // carry nulls for the series that ended first.
    const lastFull = lastCompleteHour(hours);
    expect(lastFull).toBeGreaterThan(110);
    for (const h of hours.slice(0, lastFull + 1)) {
      expect(h.tempF).not.toBeNull();
      expect(h.tempF!).toBeGreaterThan(40);
      expect(h.tempF!).toBeLessThan(100);
      expect(h.rhPct).not.toBeNull();
      expect(h.windMph).not.toBeNull();
    }
  });

  it('splits interval QPF evenly and preserves the total', () => {
    const hours = gridpointToHourly(grid as NwsGridpointResponse);
    const total = hours.reduce((a, h) => a + (h.precipMm ?? 0), 0);
    const src = (grid as NwsGridpointResponse).properties.quantitativePrecipitation!.values.reduce(
      (a, v) => a + (v.value ?? 0),
      0
    );
    expect(total).toBeCloseTo(src, 1);
  });

  it('converts °C and km/h', () => {
    const hours = gridpointToHourly({
      properties: {
        temperature: {
          uom: 'wmoUnit:degC',
          values: [{ validTime: '2026-09-25T14:00:00+00:00/PT1H', value: 20 }]
        },
        windSpeed: {
          uom: 'wmoUnit:km_h-1',
          values: [{ validTime: '2026-09-25T14:00:00+00:00/PT1H', value: 16.0934 }]
        }
      }
    });
    expect(hours[0].tempF).toBe(68);
    expect(hours[0].windMph).toBe(10);
    expect(hours[0].rhPct).toBeNull();
  });

  it('fixture derives a rain-risk window for the recorded Sep 26 afternoon rain', () => {
    const hours = gridpointToHourly(grid as NwsGridpointResponse);
    const d = deriveHourly(hours, 'data', { nowMs: Date.UTC(2026, 8, 26, 17), rainfastHours: 4 });
    expect(d.rainfast.status).toBe('rain-risk');
    const clear = deriveHourly(hours, 'data', { nowMs: Date.UTC(2026, 8, 26, 6) });
    expect(clear.rainfast.status).toBe('clear');
    expect(clear.dryWindow?.startMs).toBe(Date.UTC(2026, 8, 26, 6));
    expect(clear.dailyRain.length).toBe(5);
  });
});

describe('gridpointToHourly across forecast offices', () => {
  it.each([
    ['LWX (Leesburg, VA)', points, grid, 'LWX', [25, 100]],
    ['MOB (Mobile, AL)', pointsMob, gridMob, 'MOB', [45, 105]],
    ['TFX (Bozeman, MT, mountain grid)', pointsBzn, gridBzn, 'TFX', [5, 95]]
  ] as const)('%s parses into a gap-free hourly series', (_label, pts, g, office, [lo, hi]) => {
    expect(pts.properties.gridId).toBe(office);
    expect(pts.properties.forecastGridData).toMatch(
      new RegExp(`^https://api\\.weather\\.gov/gridpoints/${office}/`)
    );
    const hours = gridpointToHourly(g as NwsGridpointResponse);
    expect(hours.length).toBeGreaterThan(110);
    for (let i = 1; i < hours.length; i++) expect(hours[i].t - hours[i - 1].t).toBe(HOUR_MS);
    const lastFull = lastCompleteHour(hours);
    expect(lastFull).toBeGreaterThan(110);
    for (const h of hours.slice(0, lastFull + 1)) {
      expect(h.tempF).not.toBeNull();
      expect(h.tempF!).toBeGreaterThan(lo);
      expect(h.tempF!).toBeLessThan(hi);
      expect(h.rhPct!).toBeGreaterThanOrEqual(0);
      expect(h.rhPct!).toBeLessThanOrEqual(100);
      expect(h.windMph!).toBeGreaterThanOrEqual(0);
      expect(h.windMph!).toBeLessThan(60);
      if (h.popPct !== null) expect(h.popPct).toBeLessThanOrEqual(100);
    }
  });

  it('expands multi-day PoP intervals such as P2DT16H from the MOB grid', () => {
    const vt = (gridMob as NwsGridpointResponse).properties.probabilityOfPrecipitation!.values[0]
      .validTime;
    expect(vt.endsWith('/P2DT16H')).toBe(true);
    expect(expandValidTime(vt)).toHaveLength(64);
  });
});

describe('getHourlyForecast', () => {
  it('fetches points → forecastGridData with the NWS User-Agent, then caches', async () => {
    const fetchMock = mockNws();
    const lat = freshLat();
    const now = Date.UTC(2026, 8, 25, 14);
    const first = await getHourlyForecast(lat, -77.5, now);
    expect(first.provenance).toBe('data');
    expect(first.hours).toHaveLength(FIXTURE_HOURS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [pointsUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(pointsUrl).toContain(`/points/${lat},-77.5`);
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/cropcard/);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.weather.gov/gridpoints/LWX/77,79');

    const row = db
      .select()
      .from(weatherForecastCache)
      .where(eq(weatherForecastCache.cacheKey, hourlyCacheKey(lat, -77.5)))
      .get();
    expect(row).toBeDefined();
    expect(row!.expiresAt.getTime()).toBe(now + HOURLY_CACHE_TTL_MS);

    const second = await getHourlyForecast(lat, -77.5, now + 10 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.hours).toEqual(first.hours);
    expect(second.fetchedAt).toBe(now);
  });

  it('refetches after the TTL and upserts the same cache row', async () => {
    const fetchMock = mockNws();
    const lat = freshLat();
    const now = Date.UTC(2026, 8, 25, 14);
    await getHourlyForecast(lat, -77.5, now);
    await getHourlyForecast(lat, -77.5, now + HOURLY_CACHE_TTL_MS + 1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const rows = db
      .select()
      .from(weatherForecastCache)
      .where(eq(weatherForecastCache.cacheKey, hourlyCacheKey(lat, -77.5)))
      .all();
    expect(rows).toHaveLength(1);
  });

  it('does not collide with the daily forecast cache key', () => {
    expect(hourlyCacheKey(39.1, -77.5)).toBe('hourly:39.1000,-77.5000');
  });

  it('throws WeatherFetchError on HTTP failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503, statusText: 'Unavailable' }))
    );
    await expect(getHourlyForecast(freshLat(), -77.5)).rejects.toBeInstanceOf(WeatherFetchError);
  });

  it('wraps network errors as WeatherFetchError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      })
    );
    await expect(getHourlyForecast(freshLat(), -77.5)).rejects.toBeInstanceOf(WeatherFetchError);
  });

  it('throws when points has no forecastGridData', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ properties: { forecast: 'x' } })))
    );
    await expect(getHourlyForecast(freshLat(), -77.5)).rejects.toThrow(/forecastGridData/);
  });
});

describe('getHourlyForecastSafely', () => {
  it('returns fallback provenance and no hours when the feed is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      })
    );
    const r = await getHourlyForecastSafely(freshLat(), -77.5, 123);
    expect(r).toMatchObject({ hours: [], provenance: 'fallback', fetchedAt: 123 });
    expect(r.error).toMatch(/NWS/);
  });

  it('passes through data when the feed is up', async () => {
    mockNws();
    const r = await getHourlyForecastSafely(freshLat(), -77.5);
    expect(r.provenance).toBe('data');
    expect(r.error).toBeNull();
  });
});

function freshOwner(): string {
  const id = `wh-test-${randomUUID().slice(0, 12)}`;
  db.insert(owners)
    .values({ id, name: id, slug: id, billingStatus: 'active' })
    .onConflictDoNothing()
    .run();
  return id;
}

const SQUARE = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    [
      [-77.6, 39.1],
      [-77.6, 39.2],
      [-77.5, 39.2],
      [-77.5, 39.1],
      [-77.6, 39.1]
    ]
  ]
});

describe('resolveWeatherLocation', () => {
  it('falls back to the farm default when the tenant has no geometry', () => {
    runWithTenant(freshOwner(), () => {
      expect(resolveWeatherLocation(null)).toEqual({
        ...LOUDOUN_DEFAULT_LAT_LON,
        source: 'farm-default'
      });
    });
  });

  it('uses the block centroid, then another block with geometry', () => {
    runWithTenant(freshOwner(), () => {
      const geo = createBlock({ name: 'Geo', geometryGeojson: SQUARE });
      const bare = createBlock({ name: 'Bare' });
      const own = resolveWeatherLocation(geo.id);
      expect(own?.source).toBe('block');
      expect(own!.lat).toBeCloseTo(39.14, 1);
      expect(resolveWeatherLocation(bare.id)?.source).toBe('farm-block');
    });
  });

  it("never resolves another Owner's block", () => {
    const blockId = runWithTenant(
      freshOwner(),
      () => createBlock({ name: 'A', geometryGeojson: SQUARE }).id
    );
    runWithTenant(freshOwner(), () => {
      expect(resolveWeatherLocation(blockId)).toBeNull();
      expect(resolveWeatherLocation(null)?.source).toBe('farm-default');
    });
  });
});
