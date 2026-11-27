// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoilLookup } from '$lib/soil/types';

const m = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
  lookups: [] as Array<[number, number]>,
  answer: { status: 'no-data' } as unknown
}));

vi.mock('$lib/server/auth', () => ({ currentUser: () => m.user }));
vi.mock('$lib/server/soil/ssurgo.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/soil/ssurgo.server')>();
  const soilSurveyAt = async (lat: number, lon: number) => {
    m.lookups.push([lat, lon]);
    return m.answer as SoilLookup;
  };
  return {
    ...actual,
    soilSurveyAt,
    soilSurveyForArea: (id: string) =>
      actual.soilSurveyForArea(id, {
        fetcher: async (url, opts) => {
          const point = /point\((-?[\d.]+) (-?[\d.]+)\)/.exec(String(opts.body));
          m.lookups.push([Number(point?.[2]), Number(point?.[1])]);
          const { default: recorded } = await import('$lib/server/__fixtures__/sda-loudoun.json');
          return {
            url,
            status: 200,
            contentType: 'application/json',
            readText: async () => ({ text: JSON.stringify(recorded), truncated: false }),
            cancel: () => {}
          };
        }
      })
  };
});

import { db } from '$lib/db/client';
import { createField } from '$lib/db/fields';
import { owners } from '$lib/db/schema';

import { runWithTenantAsync } from '$lib/db/tenant';
import { setSetting } from '$lib/db/settings';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import loudoun from '$lib/server/__fixtures__/sda-loudoun.json';
import { resetSoilRateLimit, SOIL_PER_MINUTE } from '$lib/server/soil/ssurgo.server';
import { soilAreaResponseSchema, soilLookupSchema } from '$lib/soil/apiSchemas';
import { parseSdaTable } from '$lib/soil/parse';
import { GET as getSurvey } from './survey/+server';
import { GET as getArea } from './areas/[id]/+server';

const ok: SoilLookup = { status: 'ok', survey: parseSdaTable(loudoun, 1)! };

function survey(params: Record<string, string>, locale?: string) {
  const url = new URL('https://app.test/api/soil/survey');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return getSurvey({ url, locals: { locale } } as never) as Promise<Response>;
}

function area(id: string) {
  const url = new URL(`https://app.test/api/soil/areas/${id}`);
  return getArea({ url, params: { id }, locals: {} } as never) as Promise<Response>;
}

function seedOwner(): string {
  const id = `soil-api-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

let seq = 0;
function drawn(): string {
  seq += 1;
  const lat = 30 + seq / 991 + Math.random() / 1e4;
  const lon = -80;
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

beforeEach(() => {
  m.user = { id: 'soil-user', role: 'owner' };
  m.lookups = [];
  m.answer = ok;
  resetSoilRateLimit();
});

describe('GET /api/soil/survey', () => {
  it('requires a signed-in user', async () => {
    m.user = null;
    expect((await survey({ lat: '39.08', lon: '-77.7' })).status).toBe(401);
    expect(m.lookups).toEqual([]);
  });

  it('serves every signed-in role', async () => {
    for (const role of ['owner', 'helper', 'custom-operator', 'inspector']) {
      m.user = { id: `soil-${role}`, role };
      const res = await survey({ lat: '39.08', lon: '-77.7' });
      expect(res.status, role).toBe(200);
      expect(soilLookupSchema.parse(await res.json())).toEqual(ok);
      expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    }
    expect(m.lookups[0]).toEqual([39.08, -77.7]);
  });

  it('rejects missing, out-of-range and non-numeric coordinates before any lookup', async () => {
    for (const p of <Record<string, string>[]>[
      {},
      { lat: '39.08' },
      { lat: '91', lon: '0' },
      { lat: '0', lon: '181' },
      { lat: 'x', lon: '1' },
      { lat: '', lon: '' },
      { lat: "39.08') OR 1=1 --", lon: '-77' },
      { lat: '39.08', lon: '-77; DROP TABLE mapunit' }
    ]) {
      const res = await survey(p);
      expect(res.status, JSON.stringify(p)).toBe(400);
      expect((await res.json()).error).toBe('lat and lon must be valid coordinates');
    }
    expect(m.lookups).toEqual([]);
  });

  it('keeps no-data and unavailable apart, and does not let a browser cache an outage', async () => {
    m.answer = { status: 'no-data' };
    const none = await survey({ lat: '35', lon: '-70' });
    expect(await none.json()).toEqual({ status: 'no-data' });
    expect(none.headers.get('cache-control')).toBe('private, max-age=3600');
    m.answer = { status: 'unavailable' };
    const down = await survey({ lat: '35', lon: '-70' });
    expect(down.status).toBe(200);
    expect(await down.json()).toEqual({ status: 'unavailable' });
    expect(down.headers.get('cache-control')).toBe('no-store');
  });

  it('rate-limits per user, in the reader language', async () => {
    for (let i = 0; i < SOIL_PER_MINUTE; i++) {
      expect((await survey({ lat: '39.08', lon: '-77.7' })).status).toBe(200);
    }
    const res = await survey({ lat: '39.08', lon: '-77.7' }, 'es');
    expect(res.status).toBe(429);
    expect((await res.json()).error).not.toBe('too many lookups; try again in a minute');
    m.user = { id: 'someone-else', role: 'helper' };
    expect((await survey({ lat: '39.08', lon: '-77.7' })).status).toBe(200);
  });
});

describe('GET /api/soil/areas/[id]', () => {
  it('requires a signed-in user', async () => {
    m.user = null;
    expect((await area('anything')).status).toBe(401);
  });

  it('answers for a drawn Area, an undrawn one and one with no location at all', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const drawnArea = createField({ name: 'Drawn', geometryGeojson: drawn() });
      const res = await area(drawnArea.id);
      expect(res.status).toBe(200);
      expect(soilAreaResponseSchema.parse(await res.json())).toMatchObject({
        located: true,
        approximate: false,
        lookup: { status: 'ok', survey: { mapUnitKey: '642027', mapUnitSymbol: '20E' } }
      });
      expect(res.headers.get('cache-control')).toBe('private, max-age=3600');

      const bare = createField({ name: 'Bare' });
      const unplaced = await area(bare.id);
      expect(await unplaced.json()).toEqual({ located: false });
      expect(unplaced.headers.get('cache-control')).toBe('no-store');

      setSetting(SETTINGS_KEYS.farmLatLon, JSON.stringify({ lat: 39.1, lon: -77.6 }));
      const approx = await area(bare.id);
      expect(await approx.json()).toMatchObject({ located: true, approximate: true });
      expect(approx.headers.get('cache-control')).toBe('no-store');
      expect(m.lookups.at(-1)).toEqual([39.1, -77.6]);
    });
  });

  it("answers 404 for another Owner's Area, exactly as for a missing one", async () => {
    const theirs = seedOwner();
    const foreign = await runWithTenantAsync(theirs, async () =>
      createField({ name: 'Theirs', geometryGeojson: drawn() })
    );
    await runWithTenantAsync(seedOwner(), async () => {
      const res = await area(foreign.id);
      const missing = await area('no-such-area');
      expect(res.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(await res.json()).toEqual(await missing.json());
      expect(m.lookups).toEqual([]);
    });
    await runWithTenantAsync(theirs, async () => {
      expect((await area(foreign.id)).status).toBe(200);
    });
  });

  it('serves helpers and inspectors, and rate-limits', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const a = createField({ name: 'Drawn', geometryGeojson: drawn() });
      for (const role of ['helper', 'inspector']) {
        m.user = { id: `soil-area-${role}`, role };
        expect((await area(a.id)).status).toBe(200);
      }
      m.user = { id: 'soil-area-burst', role: 'owner' };
      for (let i = 0; i < SOIL_PER_MINUTE; i++) expect((await area(a.id)).status).toBe(200);
      expect((await area(a.id)).status).toBe(429);
    });
  });
});
