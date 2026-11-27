// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '$lib/db/client';
import { createField } from '$lib/db/fields';
import { helperAssignments, owners, users } from '$lib/db/schema';
import { createShadeSource } from '$lib/db/shadeSources';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { resetSoilRateLimit } from '$lib/server/soil/ssurgo.server';
import type { SiteFinderResponse } from '$lib/siteFinder/apiSchemas';
import { boxAround, localFrame, toLonLat, type XY } from '$lib/siteFinder/geometry';
import type { LonLat } from '$lib/siteFinder/types';
import {
  POST,
  _SITE_FINDER_PER_MINUTE,
  _requestSchema,
  _resetSiteFinderRateLimit
} from './+server';

const CENTER: LonLat = [-77.7, 39.08];
const frame = localFrame(CENTER);
const polygon = (c: XY, half: number) =>
  JSON.stringify({
    type: 'Polygon',
    coordinates: [
      (
        [
          [c[0] - half, c[1] - half],
          [c[0] + half, c[1] - half],
          [c[0] + half, c[1] + half],
          [c[0] - half, c[1] + half],
          [c[0] - half, c[1] - half]
        ] as XY[]
      ).map((p) => toLonLat(frame, p))
    ]
  });

function farm() {
  const ownerId = `sfe-owner-${randomUUID().slice(0, 10)}`;
  const userId = `sfe-user-${randomUUID().slice(0, 10)}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@test` })
    .run();
  db.insert(helperAssignments)
    .values({ ownerId, userId, roleWithinOwner: 'owner', status: 'active' })
    .run();
  return { ownerId, userId };
}

const body = (patch: Record<string, unknown> = {}) => ({
  goal: 'herb-garden',
  box: boxAround(CENTER, 40),
  footprintFt: { width: 4, length: 8 },
  useAerial: false,
  ...patch
});

function post(
  f: { ownerId: string; userId: string } | null,
  payload: unknown,
  opts: { role?: string; locale?: string; raw?: string } = {}
): Promise<Response> {
  const event = {
    request: new Request('https://app.test/api/site-finder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: opts.raw ?? JSON.stringify(payload)
    }),
    locals: {
      locale: opts.locale,
      user: f
        ? {
            id: f.userId,
            email: `${f.userId}@test`,
            phone: null,
            role: opts.role ?? 'owner',
            activeOwnerId: f.ownerId,
            isSuperadmin: false,
            impersonating: false
          }
        : undefined
    },
    cookies: { get: () => undefined }
  };
  const call = async () => {
    try {
      return (await POST(event as never)) as Response;
    } catch (e) {
      const err = e as { status?: number; body?: { message?: string } };
      if (typeof err.status === 'number') {
        return new Response(JSON.stringify(err.body ?? {}), { status: err.status });
      }
      throw e;
    }
  };
  return f ? runWithTenantAsync(f.ownerId, call) : call();
}

const saved = {
  key: process.env.ANTHROPIC_API_KEY,
  feeds: process.env.WEATHER_FEEDS,
  soil: process.env.E2E_SOIL_FIXTURE
};
beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.E2E_SOIL_FIXTURE;
  process.env.WEATHER_FEEDS = 'off';
  _resetSiteFinderRateLimit();
  resetSoilRateLimit();
});
afterEach(() => {
  for (const [name, value] of [
    ['ANTHROPIC_API_KEY', saved.key],
    ['WEATHER_FEEDS', saved.feeds],
    ['E2E_SOIL_FIXTURE', saved.soil]
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('POST /api/site-finder', () => {
  it('gives the owner up to three spots with no key, no photo and no soil service', async () => {
    const f = farm();
    const res = await post(f, body());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const out = (await res.json()) as SiteFinderResponse;
    expect(out.provenance).toBe('fallback');
    expect(out.candidates).toHaveLength(3);
    expect(out.soil).toEqual({ status: 'unavailable' });
    expect(out.imagery.used).toBe(false);
    expect(out.message).toBeNull();
    for (const c of out.candidates) {
      expect(c.polygon).toHaveLength(5);
      expect(['high', 'medium', 'low']).toContain(c.confidence);
    }
  });

  it('asked for the photo with no key, it says why and still answers', async () => {
    const res = await post(farm(), body({ useAerial: true }));
    const out = (await res.json()) as SiteFinderResponse;
    expect(res.status).toBe(200);
    expect(out).toMatchObject({ provenance: 'fallback', fallbackReason: 'no-key' });
    expect(out.message).toMatch(/Claude is not set up/);
    expect(out.candidates).toHaveLength(3);
  });

  it('is owner only: helpers, inspectors and signed-out callers are refused', async () => {
    const f = farm();
    for (const role of ['helper', 'inspector', 'custom-operator']) {
      const res = await post(f, body(), { role });
      expect(res.status, role).toBe(403);
    }
    expect((await post(null, body())).status).toBe(401);
    const es = await post(f, body(), { role: 'helper', locale: 'es' });
    expect(es.status).toBe(403);
    expect(JSON.stringify(await es.json())).toMatch(/propietario/i);
  });

  it.each([
    ['an unknown goal', { goal: 'pond' }],
    ['no box', { box: undefined }],
    ['a box that is not a rectangle', { box: { minLon: 1, minLat: 1, maxLon: 0, maxLat: 2 } }],
    ['a box larger than the goal allows', { box: boxAround(CENTER, 200) }],
    ['a tiny box', { box: boxAround(CENTER, 2) }],
    ['a zero-size plot', { footprintFt: { width: 0, length: 8 } }],
    ['a huge plot', { footprintFt: { width: 4, length: 5000 } }],
    ['useAerial that is not a boolean', { useAerial: 'yes' }],
    ['an unknown field', { model: 'opus' }],
    ['too many overlap ids', { allowOverlapAreaIds: Array(51).fill('x') }]
  ])('refuses %s', async (_name, patch) => {
    const res = await post(farm(), body(patch));
    expect(res.status).toBe(400);
  });

  it('refuses a body that is not JSON', async () => {
    expect((await post(farm(), null, { raw: '{nope' })).status).toBe(400);
  });

  it('a field goal may use the larger box', async () => {
    const res = await post(
      farm(),
      body({
        goal: 'row-crop-field',
        box: boxAround(CENTER, 390),
        footprintFt: { width: 100, length: 200 }
      })
    );
    expect(res.status).toBe(200);
  });

  it("another Owner's Area id is 400 FOREIGN_REF, and the owner's own is accepted", async () => {
    const mine = farm();
    const theirs = farm();
    const theirArea = runWithTenant(theirs.ownerId, () =>
      createField({ name: 'Their garden', kind: 'garden', geometryGeojson: polygon([0, 0], 30) })
    );
    const myArea = runWithTenant(mine.ownerId, () =>
      createField({ name: 'My garden', kind: 'garden', geometryGeojson: polygon([0, 0], 30) })
    );
    const foreign = await post(mine, body({ allowOverlapAreaIds: [theirArea.id] }));
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toMatchObject({ code: 'FOREIGN_REF' });
    const unknown = await post(mine, body({ allowOverlapAreaIds: ['nope'] }));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ code: 'FOREIGN_REF' });

    const closed = (await (await post(mine, body())).json()) as SiteFinderResponse;
    expect(closed.candidates).toEqual([]);
    const open = (await (
      await post(mine, body({ allowOverlapAreaIds: [myArea.id] }))
    ).json()) as SiteFinderResponse;
    expect(open.candidates).toHaveLength(3);
    expect(open.candidates[0].factors.find((x) => x.id === 'overlap')?.params.name).toBe(
      'My garden'
    );
  });

  it("another Owner's Areas and shade sources never shape or appear in the result", async () => {
    const mine = farm();
    const theirs = farm();
    runWithTenant(theirs.ownerId, () => {
      createField({ name: 'Their barn', kind: 'barn', geometryGeojson: polygon([0, 0], 30) });
      createField({ name: 'Their house', kind: 'residence', geometryGeojson: polygon([5, 5], 4) });
      createShadeSource({ name: 'Their oak', heightFt: 90, geometryGeojson: polygon([-5, -5], 5) });
    });
    const alone = (await (await post(farm(), body())).json()) as SiteFinderResponse;
    const out = (await (await post(mine, body())).json()) as SiteFinderResponse;
    expect(out.candidates).toEqual(alone.candidates);
    expect(out.obstacles).toEqual([]);
    expect(out.hasHouse).toBe(false);
    expect(JSON.stringify(out)).not.toMatch(/Their/);
    const theirOwn = (await (await post(theirs, body())).json()) as SiteFinderResponse;
    expect(theirOwn.candidates).toEqual([]);
    expect(theirOwn.obstacles.length).toBeGreaterThan(0);
  });

  it('limits how often one person can search', async () => {
    const f = farm();
    const small = body({ box: boxAround(CENTER, 12), footprintFt: { width: 20, length: 20 } });
    for (let i = 0; i < _SITE_FINDER_PER_MINUTE; i++) {
      expect((await post(f, small)).status).toBe(200);
    }
    expect((await post(f, small)).status).toBe(429);
    expect((await post(farm(), small)).status).toBe(200);
  });

  it('exports the schema the route checks', () => {
    expect(_requestSchema.safeParse(body()).success).toBe(true);
  });
});
