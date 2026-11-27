// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { weatherForecastCache } from '$lib/db/schema';
import { runShifted } from '$lib/server/clock';
import { SafeFetchError, type SafeFetchResponse } from '$lib/server/safeFetch';
import recorded from '$lib/server/__fixtures__/usgs-3dep-samples-loudoun.json';
import { boxAround, boxCenter, localFrame, rectOf } from '$lib/siteFinder/geometry';
import {
  TERRAIN_GRID_N,
  TERRAIN_GRID_N_SMALL,
  compassOf,
  gridPoints,
  spotTerrainFromGrid
} from '$lib/siteFinder/terrain';
import type { SearchBox } from '$lib/siteFinder/types';
import {
  TERRAIN_FIXTURE_ASPECT_DEG,
  TERRAIN_FIXTURE_SLOPE_PCT,
  TERRAIN_HOST,
  TERRAIN_MAX_BYTES,
  TERRAIN_MAX_URL_LENGTH,
  TERRAIN_PER_MINUTE,
  TERRAIN_SAMPLES_URL,
  TERRAIN_TIMEOUT_MS,
  TERRAIN_TTL_MS,
  TERRAIN_UNAVAILABLE_TTL_MS,
  allowTerrainLookup,
  fetchTerrainGrid,
  fixtureTerrainGrid,
  parseTerrainSamples,
  resetTerrainRateLimit,
  terrainBox,
  terrainCacheKey,
  terrainFixtureEnabled,
  terrainGridFor,
  terrainGridSize,
  terrainUrl,
  type TerrainFetcher
} from './terrain.server';

// The recorded file is a real USGS 3DEP getSamples answer (2026-11-27) for a
// 9 by 9 grid over a hillside in rural Loudoun County, VA.
const REAL_BOX: SearchBox = recorded.box;
const REAL_TEXT = JSON.stringify(recorded.response);

function response(
  status: number,
  body: unknown,
  opts: { truncated?: boolean; url?: string } = {}
): SafeFetchResponse {
  return {
    url: opts.url ?? TERRAIN_SAMPLES_URL,
    status,
    contentType: 'application/json',
    readText: async () => ({
      text: typeof body === 'string' ? body : JSON.stringify(body),
      truncated: opts.truncated ?? false
    }),
    cancel: vi.fn()
  };
}

type MockFetcher = ReturnType<typeof vi.fn> & TerrainFetcher;
function fetcherReturning(res: SafeFetchResponse | Error): MockFetcher {
  return vi.fn(async () => {
    if (res instanceof Error) throw res;
    return res;
  }) as MockFetcher;
}

/** A samples answer for whatever grid the request asked for. */
function planeAnswer(url: string, value: (lon: number, lat: number) => string | number | null) {
  const geometry = JSON.parse(new URL(url).searchParams.get('geometry')!) as {
    points: Array<[number, number]>;
  };
  return {
    samples: geometry.points
      .map(([x, y], locationId) => ({
        location: { x, y },
        locationId,
        value: value(x, y),
        resolution: 1.0000000000000013
      }))
      .filter((s) => s.value !== null)
      // The service does not promise an order.
      .reverse()
  };
}

const answering = (value: (lon: number, lat: number) => string | number | null): MockFetcher =>
  vi.fn(async (url: string) => response(200, planeAnswer(url, value))) as MockFetcher;

let seq = 0;
function freshBox(sizeM = 60): SearchBox {
  seq += 1;
  return boxAround([-100 + seq / 97 + Math.random() / 1e3, 35 + seq / 89], sizeM);
}

function cached(box: SearchBox) {
  return db
    .select()
    .from(weatherForecastCache)
    .where(eq(weatherForecastCache.cacheKey, terrainCacheKey(box, terrainGridSize(box))))
    .get();
}

const ENV_VARS = ['WEATHER_FEEDS', 'E2E_TERRAIN_FIXTURE', 'ENABLE_DEV_ROUTES'] as const;
const savedEnv = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]]));
beforeEach(() => {
  for (const k of ENV_VARS) delete process.env[k];
  resetTerrainRateLimit();
});
afterEach(() => {
  for (const k of ENV_VARS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('terrainUrl', () => {
  it('asks the USGS 3DEP image service for the grid points in one GET', () => {
    const url = new URL(terrainUrl(REAL_BOX, TERRAIN_GRID_N));
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe(TERRAIN_HOST);
    expect(url.pathname).toBe('/arcgis/rest/services/3DEPElevation/ImageServer/getSamples');
    expect(url.searchParams.get('geometryType')).toBe('esriGeometryMultipoint');
    expect(url.searchParams.get('returnFirstValueOnly')).toBe('true');
    expect(url.searchParams.get('f')).toBe('json');
    const geometry = JSON.parse(url.searchParams.get('geometry')!);
    expect(geometry.spatialReference).toEqual({ wkid: 4326 });
    expect(geometry.points).toHaveLength(81);
    expect(geometry.points[0]).toEqual([-77.7005, 39.0796]);
    expect(geometry.points[8]).toEqual([-77.6995, 39.0796]);
    expect(geometry.points[80]).toEqual([-77.6995, 39.0804]);
    const expected = gridPoints(REAL_BOX, 9);
    for (const [i, p] of (geometry.points as number[][]).entries()) {
      expect(p[0]).toBeCloseTo(expected[i][0], 6);
      expect(p[1]).toBeCloseTo(expected[i][1], 6);
    }
  });

  it('stays under the length cap with the full grid anywhere, and has a smaller grid to drop to', () => {
    for (const box of [
      REAL_BOX,
      boxAround([-124.123456, 48.123456], 400),
      boxAround([-68.9, 44.9], 8)
    ]) {
      expect(terrainUrl(box, TERRAIN_GRID_N).length).toBeLessThanOrEqual(TERRAIN_MAX_URL_LENGTH);
      expect(terrainGridSize(box)).toBe(TERRAIN_GRID_N);
    }
    expect(TERRAIN_GRID_N).toBe(9);
    expect(TERRAIN_GRID_N_SMALL).toBe(7);
    expect(terrainUrl(REAL_BOX, TERRAIN_GRID_N_SMALL).length).toBeLessThan(
      terrainUrl(REAL_BOX, TERRAIN_GRID_N).length
    );
  });

  it('refuses a box that is not finite numbers in order', () => {
    expect(() => terrainUrl({ ...REAL_BOX, minLon: Number.NaN }, 9)).toThrow(RangeError);
    expect(() => terrainUrl({ ...REAL_BOX, maxLat: REAL_BOX.minLat }, 9)).toThrow(RangeError);
  });

  it('rounds the box so one cache entry always means the same points', () => {
    const a = terrainBox({
      minLon: -77.700501,
      minLat: 39.079601,
      maxLon: -77.6995,
      maxLat: 39.0804
    });
    expect(a).toEqual(REAL_BOX);
    expect(terrainCacheKey(a, 9)).toBe(terrainCacheKey(REAL_BOX, 9));
    expect(terrainCacheKey(REAL_BOX, 9)).toBe('terrain:9:-77.70050,39.07960,-77.69950,39.08040');
    expect(terrainCacheKey(REAL_BOX, 7)).not.toBe(terrainCacheKey(REAL_BOX, 9));
  });
});

describe('parseTerrainSamples', () => {
  it('reads the recorded Loudoun answer: metres as strings, one sample per point', () => {
    const grid = parseTerrainSamples(REAL_TEXT, REAL_BOX, recorded.n)!;
    expect(grid.n).toBe(9);
    expect(grid.elevM).toHaveLength(81);
    expect(grid.elevM.every((z) => typeof z === 'number')).toBe(true);
    expect(grid.resolutionM).toBe(1);
    // Southwest corner is the low point, northeast the high one.
    expect(grid.elevM[0]).toBeCloseTo(96.306, 2);
    expect(grid.elevM[80]).toBeCloseTo(131.614, 2);
    expect(Math.min(...(grid.elevM as number[]))).toBe(grid.elevM[0]);
  });

  it('the recorded hillside is steep and faces southwest', () => {
    const grid = parseTerrainSamples(REAL_TEXT, REAL_BOX, recorded.n)!;
    const frame = localFrame(boxCenter(REAL_BOX));
    const whole = spotTerrainFromGrid(grid, frame, rectOf([0, 0], 86, 89))!;
    expect(whole.slopePct).toBeGreaterThan(25);
    expect(whole.slopePct).toBeLessThan(45);
    expect(compassOf(whole.aspectDeg!)).toBe('sw');
    expect(whole.coarse).toBe(false);
    // A garden-sized spot on the lower slope reads the same way.
    const spot = spotTerrainFromGrid(grid, frame, rectOf([-20, -20], 6.1, 9.1))!;
    expect(spot.slopePct).toBeGreaterThan(20);
    expect(['sw', 'w', 's']).toContain(compassOf(spot.aspectDeg!));
  });

  it('matches samples by locationId, whatever order they arrive in', () => {
    const shuffled = { samples: [...recorded.response.samples].reverse() };
    expect(parseTerrainSamples(JSON.stringify(shuffled), REAL_BOX, 9)).toEqual(
      parseTerrainSamples(REAL_TEXT, REAL_BOX, 9)
    );
  });

  it('a missing sample or a value that is not ground is unknown', () => {
    const samples = recorded.response.samples.map((s) => ({ ...s }));
    samples[3].value = 'NoData';
    samples[4].value = '-3.4028234663852886e+38';
    samples[5].value = '';
    (samples[6] as { value: unknown }).value = null;
    samples.splice(10, 1);
    const grid = parseTerrainSamples(JSON.stringify({ samples }), REAL_BOX, 9)!;
    for (const id of [3, 4, 5, 6, 10]) expect(grid.elevM[id]).toBeNull();
    expect(grid.elevM[7]).toBeCloseTo(Number(recorded.response.samples[7].value), 6);
    expect(grid.elevM.filter((z) => z === null)).toHaveLength(5);
  });

  it('ignores samples it cannot place and keeps the coarsest resolution', () => {
    const grid = parseTerrainSamples(
      JSON.stringify({
        samples: [
          { locationId: 0, value: '10', resolution: 1 },
          { locationId: 1, value: 11.5, resolution: 10.2 },
          { locationId: 99, value: '12', resolution: 30 },
          { locationId: -1, value: '12' },
          { locationId: 1.5, value: '12' },
          { locationId: '2', value: '12' },
          { value: '12' },
          null,
          'x'
        ]
      }),
      REAL_BOX,
      2
    )!;
    expect(grid.elevM).toEqual([10, 11.5, null, null]);
    expect(grid.resolutionM).toBe(10.2);
  });

  it('is null for a body that is not a samples answer', () => {
    for (const text of [
      '',
      'not json',
      '[]',
      'null',
      '{}',
      '{"error":{"code":400}}',
      '{"samples":5}'
    ]) {
      expect(parseTerrainSamples(text, REAL_BOX, 9), text).toBeNull();
    }
    expect(parseTerrainSamples('{"samples":[]}', REAL_BOX, 9)!.elevM.every((z) => z === null)).toBe(
      true
    );
  });
});

describe('fetchTerrainGrid', () => {
  it('returns the grid, host-pinned with no redirects, a cap and a timeout', async () => {
    const fetcher = fetcherReturning(response(200, recorded.response));
    const out = await fetchTerrainGrid(REAL_BOX, fetcher);
    expect(out.status).toBe('ok');
    if (out.status === 'ok') {
      expect(out.grid.box).toEqual(REAL_BOX);
      expect(out.grid.elevM[80]).toBeCloseTo(131.614, 2);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, opts] = fetcher.mock.calls[0] as [string, Record<string, unknown>];
    expect(new URL(url).hostname).toBe(TERRAIN_HOST);
    expect(url).toBe(terrainUrl(REAL_BOX, 9));
    expect(opts).toMatchObject({
      maxRedirects: 0,
      maxBytes: TERRAIN_MAX_BYTES,
      timeoutMs: TERRAIN_TIMEOUT_MS
    });
    expect(opts.method).toBeUndefined();
    expect(opts.body).toBeUndefined();
    expect(TERRAIN_TIMEOUT_MS).toBeLessThanOrEqual(8_000);
    expect(TERRAIN_MAX_BYTES).toBeLessThanOrEqual(300_000);
    expect(REAL_TEXT.length).toBeLessThan(TERRAIN_MAX_BYTES);
  });

  it('is "no data" when the service answers with too few elevations', async () => {
    expect(
      await fetchTerrainGrid(REAL_BOX, fetcherReturning(response(200, { samples: [] })))
    ).toEqual({ status: 'no-data' });
    expect(
      await fetchTerrainGrid(
        REAL_BOX,
        answering(() => 'NoData')
      )
    ).toEqual({
      status: 'no-data'
    });
    const three = { samples: recorded.response.samples.slice(0, 3) };
    expect(await fetchTerrainGrid(REAL_BOX, fetcherReturning(response(200, three)))).toEqual({
      status: 'no-data'
    });
  });

  it('is unavailable for a bad status, another host, a cut-off body, junk or a failure', async () => {
    const cases = [
      fetcherReturning(response(500, recorded.response)),
      fetcherReturning(response(302, '')),
      fetcherReturning(response(200, recorded.response, { url: 'https://example.com/getSamples' })),
      fetcherReturning(response(200, recorded.response, { truncated: true })),
      fetcherReturning(response(200, '<html>busy</html>')),
      fetcherReturning(response(200, { error: { code: 400, message: 'Invalid' } })),
      fetcherReturning(new SafeFetchError('timeout', 'Request timed out')),
      fetcherReturning(new Error('ENOTFOUND'))
    ];
    for (const fetcher of cases) {
      expect(await fetchTerrainGrid(REAL_BOX, fetcher)).toEqual({ status: 'unavailable' });
    }
    const bad = fetcherReturning(response(200, recorded.response));
    expect(await fetchTerrainGrid({ ...REAL_BOX, minLat: Number.NaN }, bad)).toEqual({
      status: 'unavailable'
    });
    expect(bad).not.toHaveBeenCalled();
  });
});

describe('terrainGridFor', () => {
  const now = Date.UTC(2026, 10, 27, 12);
  const slope = () => answering((lon, lat) => String(100 + (lat - 35) * 1000 + lon * 0));

  it('fetches once, then answers from the cache for 180 days', async () => {
    const box = freshBox();
    const fetcher = slope();
    const first = await terrainGridFor(box, { fetcher, now });
    expect(first.status).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cached(box)!.expiresAt.getTime()).toBe(now + TERRAIN_TTL_MS);
    expect(TERRAIN_TTL_MS).toBe(180 * 86_400_000);

    const again = fetcherReturning(new Error('should not be called'));
    expect(await terrainGridFor(box, { fetcher: again, now: now + TERRAIN_TTL_MS - 1 })).toEqual(
      first
    );
    expect(again).not.toHaveBeenCalled();

    const later = slope();
    expect((await terrainGridFor(box, { fetcher: later, now: now + TERRAIN_TTL_MS })).status).toBe(
      'ok'
    );
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('caches "no data" as long as an answer', async () => {
    const box = freshBox();
    expect(await terrainGridFor(box, { fetcher: answering(() => 'NoData'), now })).toEqual({
      status: 'no-data'
    });
    expect(cached(box)!.expiresAt.getTime()).toBe(now + TERRAIN_TTL_MS);
    const again = slope();
    expect(await terrainGridFor(box, { fetcher: again, now: now + 86_400_000 })).toEqual({
      status: 'no-data'
    });
    expect(again).not.toHaveBeenCalled();
  });

  it('holds "unavailable" for only a few minutes, then tries again', async () => {
    const box = freshBox();
    const down = fetcherReturning(new SafeFetchError('timeout', 'Request timed out'));
    expect(await terrainGridFor(box, { fetcher: down, now })).toEqual({ status: 'unavailable' });
    expect(TERRAIN_UNAVAILABLE_TTL_MS).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(cached(box)!.expiresAt.getTime()).toBe(now + TERRAIN_UNAVAILABLE_TTL_MS);
    const still = slope();
    expect((await terrainGridFor(box, { fetcher: still, now: now + 1000 })).status).toBe(
      'unavailable'
    );
    expect(still).not.toHaveBeenCalled();
    const back = slope();
    expect(
      (await terrainGridFor(box, { fetcher: back, now: now + TERRAIN_UNAVAILABLE_TTL_MS })).status
    ).toBe('ok');
  });

  it('ignores a cache row it cannot read', async () => {
    const box = freshBox();
    for (const payloadJson of [
      '{"lookup":{"status":"ok","grid":{"n":9,"elevM":[1,2,3]}}}',
      'not json'
    ]) {
      db.insert(weatherForecastCache)
        .values({
          id: randomUUID(),
          cacheKey: terrainCacheKey(box, 9),
          fetchedAt: new Date(now),
          expiresAt: new Date(now + TERRAIN_TTL_MS),
          payloadJson
        })
        .onConflictDoUpdate({ target: weatherForecastCache.cacheKey, set: { payloadJson } })
        .run();
      const fetcher = slope();
      expect((await terrainGridFor(box, { fetcher, now })).status).toBe('ok');
      expect(fetcher).toHaveBeenCalledTimes(1);
      db.delete(weatherForecastCache)
        .where(eq(weatherForecastCache.cacheKey, terrainCacheKey(box, 9)))
        .run();
    }
  });

  it('shares one request between concurrent callers', async () => {
    const box = freshBox();
    const fetcher = slope();
    const [a, b] = await Promise.all([
      terrainGridFor(box, { fetcher }),
      terrainGridFor(box, { fetcher })
    ]);
    expect(a).toBe(b);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('a demo request on a fast-forwarded clock caches on the real clock', async () => {
    const box = freshBox();
    const before = Date.now();
    await runShifted(400 * 86_400_000, () => terrainGridFor(box, { fetcher: slope() }));
    const row = cached(box)!;
    expect(row.fetchedAt.getTime()).toBeLessThan(before + 60_000);
    expect(row.expiresAt.getTime()).toBeLessThan(before + TERRAIN_TTL_MS + 60_000);
    const again = fetcherReturning(new Error('should not be called'));
    expect((await terrainGridFor(box, { fetcher: again })).status).toBe('ok');
    expect(again).not.toHaveBeenCalled();
  });

  it('answers unavailable without fetching or caching when weather feeds are off', async () => {
    process.env.WEATHER_FEEDS = 'off';
    const box = freshBox();
    const fetcher = slope();
    expect(await terrainGridFor(box, { fetcher })).toEqual({ status: 'unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(cached(box)).toBeUndefined();
  });

  it('answers unavailable for a box that is not a box', async () => {
    const fetcher = slope();
    expect(await terrainGridFor({ ...REAL_BOX, maxLon: Number.NaN }, { fetcher })).toEqual({
      status: 'unavailable'
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('the per-user limit', () => {
  it('allows a set number of lookups a minute per user', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < TERRAIN_PER_MINUTE; i++)
      expect(allowTerrainLookup('u1', t0 + i)).toBe(true);
    expect(allowTerrainLookup('u1', t0 + 100)).toBe(false);
    expect(allowTerrainLookup('u2', t0 + 100)).toBe(true);
    expect(allowTerrainLookup('u1', t0 + 60_001 + TERRAIN_PER_MINUTE)).toBe(true);
  });
});

describe('the e2e terrain fixture', () => {
  it('needs both flags', () => {
    expect(terrainFixtureEnabled({ E2E_TERRAIN_FIXTURE: '1', ENABLE_DEV_ROUTES: '1' })).toBe(true);
    for (const env of [
      {},
      { E2E_TERRAIN_FIXTURE: '1' },
      { ENABLE_DEV_ROUTES: '1' },
      { E2E_TERRAIN_FIXTURE: 'true', ENABLE_DEV_ROUTES: '1' },
      { E2E_TERRAIN_FIXTURE: '1', ENABLE_DEV_ROUTES: 'yes' }
    ]) {
      expect(terrainFixtureEnabled(env)).toBe(false);
    }
  });

  it('makes one even slope for whatever box is asked, with feeds off and no fetch', async () => {
    process.env.E2E_TERRAIN_FIXTURE = '1';
    process.env.ENABLE_DEV_ROUTES = '1';
    process.env.WEATHER_FEEDS = 'off';
    for (const box of [freshBox(60), freshBox(8), freshBox(400)]) {
      const fetcher = fetcherReturning(new Error('should not be called'));
      const out = await terrainGridFor(box, { fetcher });
      expect(fetcher).not.toHaveBeenCalled();
      expect(out.status).toBe('ok');
      if (out.status !== 'ok') continue;
      const frame = localFrame(boxCenter(box));
      const got = spotTerrainFromGrid(out.grid, frame, rectOf([1, -1], 3, 3))!;
      expect(got.slopePct).toBeCloseTo(TERRAIN_FIXTURE_SLOPE_PCT, 1);
      expect(compassOf(got.aspectDeg!)).toBe(compassOf(TERRAIN_FIXTURE_ASPECT_DEG));
      expect(got.coarse).toBe(false);
      expect(cached(box)).toBeUndefined();
    }
    expect(compassOf(TERRAIN_FIXTURE_ASPECT_DEG)).toBe('n');
    expect(fixtureTerrainGrid(REAL_BOX).elevM).toHaveLength(TERRAIN_GRID_N ** 2);
  });

  it('is off with only one flag', async () => {
    process.env.E2E_TERRAIN_FIXTURE = '1';
    process.env.WEATHER_FEEDS = 'off';
    expect(await terrainGridFor(freshBox())).toEqual({ status: 'unavailable' });
  });

  it('the recorded answer is a small real response with its source noted', () => {
    expect(recorded.source).toMatch(/3DEP/);
    expect(recorded.recorded).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(recorded.response.samples).toHaveLength(81);
    expect(typeof recorded.response.samples[0].value).toBe('string');
  });

  const repo = (rel: string) => readFileSync(resolve(process.cwd(), '../..', rel), 'utf8');

  for (const file of ['infra/azure/main.bicep', 'infra/Dockerfile', 'infra/docker-compose.yml']) {
    it(`${file} never mentions E2E_TERRAIN_FIXTURE`, () => {
      expect(repo(file)).not.toMatch(/E2E_TERRAIN_FIXTURE/);
    });
  }

  it('infra/.env.dev.example documents the flag without setting it', () => {
    const text = repo('infra/.env.dev.example');
    expect(text).toMatch(/E2E_TERRAIN_FIXTURE/);
    for (const line of text.split('\n')) {
      if (line.includes('E2E_TERRAIN_FIXTURE')) expect(line.startsWith('#')).toBe(true);
    }
  });

  it('the Playwright config sets it on the main preview server only', () => {
    const config = repo('apps/web/playwright.config.ts');
    expect(config.match(/E2E_TERRAIN_FIXTURE=1 /g)).toHaveLength(1);
    const main = config.indexOf('E2E_TERRAIN_FIXTURE=1 ');
    const magic = config.indexOf('AUTH_MODE=magic-link AUTH_SECRET');
    expect(main).toBeGreaterThan(0);
    expect(main).toBeLessThan(magic);
  });
});

describe('terrain stays out of the safety kernel and the page loaders', () => {
  const SRC = resolve(process.cwd(), 'src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|js|mjs|svelte)$/.test(name) ? [path] : [];
    });
  const FINDER = /siteFinder|terrain\.server|terrainGridFor|spotTerrain|TerrainGrid/;

  it('the pattern catches the ways a module could reach it', () => {
    for (const line of [
      "import { findSpots } from '$lib/siteFinder/candidates';",
      "import { terrainGridFor } from '$lib/server/siteFinder/terrain.server';",
      "import type { TerrainGrid } from '../siteFinder/terrain';",
      "const m = await import('./terrain.server');"
    ]) {
      expect(FINDER.test(line), line).toBe(true);
    }
  });

  it('nothing in lib/safety imports or names Find a spot or the terrain module', () => {
    const scanned = files(join(SRC, 'lib/safety'));
    expect(scanned.length).toBeGreaterThan(20);
    expect(scanned.filter((p) => FINDER.test(readFileSync(p, 'utf8')))).toEqual([]);
  });

  it('no page or layout loader fetches terrain: only the Find a spot run does', () => {
    const users = files(SRC).filter(
      (p) =>
        !/\.test\.ts$/.test(p) &&
        !p.endsWith('terrain.server.ts') &&
        /terrain\.server|terrainGridFor/.test(readFileSync(p, 'utf8'))
    );
    expect(users.map((p) => p.slice(SRC.length + 1))).toEqual(['lib/server/siteFinder/run.ts']);
  });
});
