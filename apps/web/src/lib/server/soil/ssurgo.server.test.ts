// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { createField } from '$lib/db/fields';
import { owners, weatherForecastCache } from '$lib/db/schema';

import { runWithTenantAsync } from '$lib/db/tenant';
import { setSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { runShifted } from '$lib/server/clock';
import {
  safeFetch,
  SafeFetchError,
  type Connector,
  type SafeFetchOptions,
  type SafeFetchResponse
} from '$lib/server/safeFetch';
import loudoun from '$lib/server/__fixtures__/sda-loudoun.json';
import mobile from '$lib/server/__fixtures__/sda-mobile-water-table.json';
import {
  allowSoilLookup,
  fetchSoilSurvey,
  resetSoilRateLimit,
  sdaQuery,
  SDA_HOST,
  SDA_URL,
  SOIL_MAX_BYTES,
  SOIL_PER_MINUTE,
  SOIL_TIMEOUT_MS,
  SOIL_TTL_MS,
  SOIL_UNAVAILABLE_TTL_MS,
  soilCacheKey,
  soilFixtureEnabled,
  soilSurveyAt,
  soilSurveyForArea,
  type SoilFetcher
} from './ssurgo.server';

// Fixtures are live Soil Data Access answers recorded 2026-11-27 (see
// lib/soil/soil.test.ts).
const sdaError = readFileSync(
  resolve(process.cwd(), 'src/lib/server/__fixtures__/sda-error.xml'),
  'utf8'
);

function response(
  status: number,
  body: unknown,
  opts: { truncated?: boolean; url?: string } = {}
): SafeFetchResponse {
  return {
    url: opts.url ?? SDA_URL,
    status,
    contentType: 'application/json',
    readText: async () => ({
      text: typeof body === 'string' ? body : JSON.stringify(body),
      truncated: opts.truncated ?? false
    }),
    cancel: vi.fn()
  };
}

type MockFetcher = ReturnType<typeof vi.fn> & SoilFetcher;
function fetcherReturning(res: SafeFetchResponse | Error): MockFetcher {
  return vi.fn(async () => {
    if (res instanceof Error) throw res;
    return res;
  }) as MockFetcher;
}

let seq = 0;
function freshLat(): number {
  seq += 1;
  return 20 + seq / 997 + Math.random() / 1e4;
}

function cached(lat: number, lon: number) {
  return db
    .select()
    .from(weatherForecastCache)
    .where(eq(weatherForecastCache.cacheKey, soilCacheKey(lat, lon)))
    .get();
}

const ENV_VARS = ['WEATHER_FEEDS', 'E2E_SOIL_FIXTURE', 'ENABLE_DEV_ROUTES'] as const;
const savedEnv = Object.fromEntries(ENV_VARS.map((k) => [k, process.env[k]]));
beforeEach(() => {
  for (const k of ENV_VARS) delete process.env[k];
  resetSoilRateLimit();
});
afterEach(() => {
  for (const k of ENV_VARS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('sdaQuery', () => {
  it('writes the point as two fixed-decimal numbers, longitude first', () => {
    const q = sdaQuery(39.08, -77.7);
    expect(q).toContain(
      "SDA_Get_Mukey_from_intersection_with_WktWgs84('point(-77.70000 39.08000)')"
    );
    expect(q.startsWith('SELECT mu.mukey')).toBe(true);
    expect(q.endsWith('ORDER BY c.comppct_r DESC, c.cokey')).toBe(true);
  });

  it('is the same text for every point apart from the two numbers', () => {
    const shape = sdaQuery(0, 0).replace('point(0.00000 0.00000)', 'point(X)');
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (lat, lon) => {
          const q = sdaQuery(lat, lon);
          const point = /point\((-?\d{1,3}\.\d{5}) (-?\d{1,2}\.\d{5})\)/.exec(q);
          expect(point).not.toBeNull();
          expect(q.replace(point![0], 'point(X)')).toBe(shape);
        }
      )
    );
  });

  it('refuses anything that is not a point on Earth', () => {
    for (const [lat, lon] of [
      [91, 0],
      [0, 181],
      [NaN, 0],
      [0, Infinity],
      ['39' as unknown as number, 0]
    ]) {
      expect(() => sdaQuery(lat, lon)).toThrow(RangeError);
    }
  });
});

describe('fetchSoilSurvey', () => {
  it('posts the query to the pinned host with no redirects, a timeout and a size cap', async () => {
    const fetcher = fetcherReturning(response(200, loudoun));
    const out = await fetchSoilSurvey(39.08, -77.7, fetcher, 1234);
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.survey.mapUnitName).toBe(
      'Tankerville and Purcellville soils, 25 to 45 percent slopes'
    );
    expect(out.survey.source.fetchedAt).toBe(1234);
    const [url, opts] = fetcher.mock.calls[0] as [string, SafeFetchOptions];
    expect(url).toBe(`https://${SDA_HOST}/Tabular/post.rest`);
    expect(opts).toMatchObject({
      method: 'POST',
      timeoutMs: SOIL_TIMEOUT_MS,
      maxBytes: SOIL_MAX_BYTES,
      maxRedirects: 0
    });
    expect(JSON.parse(opts.body!)).toEqual({
      format: 'JSON+COLUMNNAME',
      query: sdaQuery(39.08, -77.7)
    });
  });

  it('tells "the survey has nothing here" from "could not reach it"', async () => {
    const at = (res: SafeFetchResponse | Error) =>
      fetchSoilSurvey(35, -70, fetcherReturning(res)).then((r) => r.status);
    expect(await at(response(200, {}))).toBe('no-data');
    expect(await at(response(200, { Table: [] }))).toBe('no-data');
    expect(await at(response(400, sdaError))).toBe('unavailable');
    expect(await at(response(200, sdaError))).toBe('unavailable');
    expect(await at(response(500, {}))).toBe('unavailable');
    expect(await at(response(200, loudoun, { truncated: true }))).toBe('unavailable');
    expect(await at(response(200, JSON.stringify(loudoun).slice(0, 300)))).toBe('unavailable');
    expect(await at(response(200, { Table: [['mukey'], [null]] }))).toBe('unavailable');
    expect(await at(new SafeFetchError('timeout', 'Request timed out'))).toBe('unavailable');
    expect(await at(new SafeFetchError('network', 'reset'))).toBe('unavailable');
  });

  it('refuses an answer that came from another host', async () => {
    const res = response(200, loudoun, { url: 'https://evil.example/Tabular/post.rest' });
    expect((await fetchSoilSurvey(39, -77, fetcherReturning(res))).status).toBe('unavailable');
    expect(res.cancel).toHaveBeenCalled();
  });

  it('does not follow a redirect from the real transport', async () => {
    const calls: string[] = [];
    const connector: Connector = async ({ url }) => {
      calls.push(url.toString());
      return {
        status: 302,
        headers: { location: 'https://evil.example/steal' },
        body: (async function* () {})(),
        destroy: () => {}
      };
    };
    const fetcher: SoilFetcher = (url, opts) =>
      safeFetch(url, {
        ...opts,
        connector,
        resolver: async () => [{ address: '93.184.216.34', family: 4 }]
      });
    expect((await fetchSoilSurvey(39, -77, fetcher)).status).toBe('unavailable');
    expect(calls).toEqual([SDA_URL]);
  });

  it('never fetches for a point that is not on Earth', async () => {
    const fetcher = fetcherReturning(response(200, loudoun));
    expect((await fetchSoilSurvey(95, -77, fetcher)).status).toBe('no-data');
    expect((await fetchSoilSurvey(NaN, -77, fetcher)).status).toBe('no-data');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('soilSurveyAt', () => {
  const now = Date.UTC(2026, 10, 27);

  it('caches an answer for 180 days and serves it without fetching again', async () => {
    const lat = freshLat();
    const first = await soilSurveyAt(lat, -77.7, {
      fetcher: fetcherReturning(response(200, loudoun)),
      now
    });
    expect(first.status).toBe('ok');
    const row = cached(lat, -77.7)!;
    expect(row.cacheKey).toBe(`soil:${lat.toFixed(4)},-77.7000`);
    expect(row.expiresAt.getTime()).toBe(now + SOIL_TTL_MS);
    const again = fetcherReturning(new Error('should not be called'));
    expect(await soilSurveyAt(lat, -77.7, { fetcher: again, now: now + SOIL_TTL_MS - 1 })).toEqual(
      first
    );
    expect(again).not.toHaveBeenCalled();
    const later = fetcherReturning(response(200, mobile));
    const refreshed = await soilSurveyAt(lat, -77.7, { fetcher: later, now: now + SOIL_TTL_MS });
    expect(later).toHaveBeenCalledTimes(1);
    expect(refreshed.status === 'ok' && refreshed.survey.mapUnitSymbol).toBe('SbC');
  });

  it('caches "no data" as long as an answer', async () => {
    const lat = freshLat();
    expect(
      await soilSurveyAt(lat, -70, { fetcher: fetcherReturning(response(200, {})), now })
    ).toEqual({ status: 'no-data' });
    expect(cached(lat, -70)!.expiresAt.getTime()).toBe(now + SOIL_TTL_MS);
    const again = fetcherReturning(response(200, loudoun));
    expect(await soilSurveyAt(lat, -70, { fetcher: again, now: now + 86_400_000 })).toEqual({
      status: 'no-data'
    });
    expect(again).not.toHaveBeenCalled();
  });

  it('holds "unavailable" for only a few minutes, then tries again', async () => {
    const lat = freshLat();
    const down = fetcherReturning(new SafeFetchError('timeout', 'Request timed out'));
    expect(await soilSurveyAt(lat, -77, { fetcher: down, now })).toEqual({
      status: 'unavailable'
    });
    expect(SOIL_UNAVAILABLE_TTL_MS).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(cached(lat, -77)!.expiresAt.getTime()).toBe(now + SOIL_UNAVAILABLE_TTL_MS);
    const still = fetcherReturning(response(200, loudoun));
    expect((await soilSurveyAt(lat, -77, { fetcher: still, now: now + 1000 })).status).toBe(
      'unavailable'
    );
    expect(still).not.toHaveBeenCalled();
    const back = fetcherReturning(response(200, loudoun));
    expect(
      (await soilSurveyAt(lat, -77, { fetcher: back, now: now + SOIL_UNAVAILABLE_TTL_MS })).status
    ).toBe('ok');
  });

  it('ignores a cache row it cannot read', async () => {
    const lat = freshLat();
    db.insert(weatherForecastCache)
      .values({
        id: randomUUID(),
        cacheKey: soilCacheKey(lat, -77),
        fetchedAt: new Date(now),
        expiresAt: new Date(now + SOIL_TTL_MS),
        payloadJson: '{"lookup":{"status":"ok","survey":{"mapUnitKey":7}}}'
      })
      .run();
    const fetcher = fetcherReturning(response(200, loudoun));
    expect((await soilSurveyAt(lat, -77, { fetcher, now })).status).toBe('ok');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('shares one request between concurrent callers', async () => {
    const lat = freshLat();
    const fetcher = fetcherReturning(response(200, loudoun));
    const [a, b] = await Promise.all([
      soilSurveyAt(lat, -77, { fetcher }),
      soilSurveyAt(lat, -77, { fetcher })
    ]);
    expect(a).toBe(b);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('a demo request on a fast-forwarded clock caches on the real clock', async () => {
    const lat = freshLat();
    const before = Date.now();
    const out = await runShifted(400 * 86_400_000, () =>
      soilSurveyAt(lat, -77, { fetcher: fetcherReturning(response(200, loudoun)) })
    );
    const row = cached(lat, -77)!;
    expect(row.fetchedAt.getTime()).toBeLessThan(before + 60_000);
    expect(row.expiresAt.getTime()).toBeLessThan(before + SOIL_TTL_MS + 60_000);
    expect(out.status === 'ok' && out.survey.source.fetchedAt).toBeLessThan(before + 60_000);
    const again = fetcherReturning(new Error('should not be called'));
    expect((await soilSurveyAt(lat, -77, { fetcher: again })).status).toBe('ok');
    expect(again).not.toHaveBeenCalled();
  });

  it('answers unavailable without fetching or caching when weather feeds are off', async () => {
    process.env.WEATHER_FEEDS = 'off';
    const lat = freshLat();
    const fetcher = fetcherReturning(response(200, loudoun));
    expect(await soilSurveyAt(lat, -77, { fetcher })).toEqual({ status: 'unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(cached(lat, -77)).toBeUndefined();
  });

  it('answers no-data for a point that is not on Earth', async () => {
    const fetcher = fetcherReturning(response(200, loudoun));
    expect(await soilSurveyAt(120, 0, { fetcher })).toEqual({ status: 'no-data' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('the e2e soil fixture', () => {
  it('needs both flags', () => {
    expect(soilFixtureEnabled({ E2E_SOIL_FIXTURE: '1', ENABLE_DEV_ROUTES: '1' })).toBe(true);
    for (const env of [
      {},
      { E2E_SOIL_FIXTURE: '1' },
      { ENABLE_DEV_ROUTES: '1' },
      { E2E_SOIL_FIXTURE: 'true', ENABLE_DEV_ROUTES: '1' },
      { E2E_SOIL_FIXTURE: '1', ENABLE_DEV_ROUTES: 'yes' }
    ]) {
      expect(soilFixtureEnabled(env)).toBe(false);
    }
  });

  it('serves the recorded Loudoun answer for any point, with feeds off and no fetch', async () => {
    process.env.E2E_SOIL_FIXTURE = '1';
    process.env.ENABLE_DEV_ROUTES = '1';
    process.env.WEATHER_FEEDS = 'off';
    const lat = freshLat();
    const fetcher = fetcherReturning(new Error('should not be called'));
    const out = await soilSurveyAt(lat, -100, { fetcher, now: 99 });
    expect(out.status === 'ok' && out.survey.mapUnitSymbol).toBe('20E');
    expect(out.status === 'ok' && out.survey.source.fetchedAt).toBe(99);
    expect(fetcher).not.toHaveBeenCalled();
    expect(cached(lat, -100)).toBeUndefined();
  });

  it('is off with only one flag', async () => {
    process.env.E2E_SOIL_FIXTURE = '1';
    process.env.WEATHER_FEEDS = 'off';
    expect(await soilSurveyAt(freshLat(), -100)).toEqual({ status: 'unavailable' });
  });

  const repo = (rel: string) => readFileSync(resolve(process.cwd(), '../..', rel), 'utf8');

  for (const file of ['infra/azure/main.bicep', 'infra/Dockerfile', 'infra/docker-compose.yml']) {
    it(`${file} never mentions E2E_SOIL_FIXTURE`, () => {
      expect(repo(file)).not.toMatch(/E2E_SOIL_FIXTURE/);
    });
  }

  it('infra/.env.dev.example documents the flag without setting it', () => {
    const text = repo('infra/.env.dev.example');
    expect(text).toMatch(/E2E_SOIL_FIXTURE/);
    for (const line of text.split('\n')) {
      if (line.includes('E2E_SOIL_FIXTURE')) expect(line.startsWith('#')).toBe(true);
    }
  });

  it('the Playwright config sets it on the main preview server only', () => {
    const config = repo('apps/web/playwright.config.ts');
    expect(config.match(/E2E_SOIL_FIXTURE=1 /g)).toHaveLength(1);
    const main = config.indexOf('E2E_SOIL_FIXTURE=1 ');
    const magic = config.indexOf('AUTH_MODE=magic-link AUTH_SECRET');
    expect(main).toBeGreaterThan(0);
    expect(main).toBeLessThan(magic);
  });
});

describe('allowSoilLookup', () => {
  it('allows a burst per user, then refuses until the window passes', () => {
    const now = 1_000_000;
    for (let i = 0; i < SOIL_PER_MINUTE; i++) expect(allowSoilLookup('u1', now)).toBe(true);
    expect(allowSoilLookup('u1', now)).toBe(false);
    expect(allowSoilLookup('u2', now)).toBe(true);
    expect(allowSoilLookup('u1', now + 60_001)).toBe(true);
  });
});

describe('soilSurveyForArea', () => {
  function seedOwner(): string {
    const id = `soil-${randomUUID()}`;
    db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
    return id;
  }
  function square(lat: number, lon: number): string {
    const d = 0.001;
    return JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [lon - d, lat - d],
          [lon + d, lat - d],
          [lon + d, lat + d],
          [lon - d, lat + d],
          [lon - d, lat - d]
        ]
      ]
    });
  }

  it('looks up the centre of a drawn Area', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const lat = freshLat();
      const area = createField({ name: 'Drawn', geometryGeojson: square(lat, -77.7) });
      const fetcher = fetcherReturning(response(200, loudoun));
      const out = await soilSurveyForArea(area.id, { fetcher });
      expect(out).toMatchObject({ approximate: false, lookup: { status: 'ok' } });
      expect(out!.lat).toBeCloseTo(lat, 5);
      expect(out!.lon).toBeCloseTo(-77.7, 5);
      const sent = JSON.parse((fetcher.mock.calls[0] as [string, SafeFetchOptions])[1].body!);
      expect(sent.query).toContain(`point(-77.70000 ${lat.toFixed(5)})`);
    });
  });

  it("falls back to the farm's saved location and says it is approximate", async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const area = createField({ name: 'Not drawn', widthFt: 20, lengthFt: 40 });
      expect(await soilSurveyForArea(area.id)).toBeNull();
      const lat = freshLat();
      setSetting(SETTINGS_KEYS.farmLatLon, JSON.stringify({ lat, lon: -77.5 }));
      const fetcher = fetcherReturning(response(200, mobile));
      const out = await soilSurveyForArea(area.id, { fetcher });
      expect(out).toMatchObject({ approximate: true, lat, lon: -77.5, lookup: { status: 'ok' } });
    });
  });

  it("answers undefined for a missing Area and for another Owner's Area, without fetching", async () => {
    const mine = seedOwner();
    const theirs = seedOwner();
    const foreign = await runWithTenantAsync(theirs, async () =>
      createField({ name: 'Theirs', geometryGeojson: square(freshLat(), -77.7) })
    );
    await runWithTenantAsync(mine, async () => {
      const fetcher = fetcherReturning(response(200, loudoun));
      expect(await soilSurveyForArea(foreign.id, { fetcher })).toBeUndefined();
      expect(await soilSurveyForArea('nope', { fetcher })).toBeUndefined();
      expect(fetcher).not.toHaveBeenCalled();
    });
  });
});
