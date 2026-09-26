// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenantAsync, runWithTenant } from '$lib/db/tenant';
import * as fieldsRepo from '$lib/db/fields';
import * as mapFeaturesRepo from '$lib/db/mapFeatures';
import { deleteFieldCascade } from '$lib/db/admin';

const auth = vi.hoisted(() => ({ role: 'owner' as 'owner' | 'helper' }));
vi.mock('$lib/server/auth', async () => {
  const { error } = await import('@sveltejs/kit');
  return {
    currentUser: () => ({ id: 'user-1', role: auth.role }),
    requireOwner: () => {
      if (auth.role !== 'owner') throw error(403, 'owner role required');
      return { id: 'user-1', role: auth.role };
    }
  };
});

import { GET as LIST, POST } from './+server';
import { DELETE, GET as GET_ONE, PATCH } from './[id]/+server';

function seedOwner(): string {
  const id = `map-features-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function req(method: string, url: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

const BASE = 'http://localhost/api/map-features';
const create = (body: unknown) => POST({ request: req('POST', BASE, body) } as never);
const list = (query = '') => LIST({ url: new URL(`${BASE}${query}`) } as never);
const getOne = (id: string) => GET_ONE({ params: { id } } as never);
const patch = (id: string, body: unknown) =>
  PATCH({ params: { id }, request: req('PATCH', `${BASE}/${id}`, body) } as never);
const remove = (id: string) => DELETE({ params: { id } } as never);

async function expectStatus(run: () => Promise<Response> | Response, status: number) {
  try {
    const res = await run();
    expect(res.status).toBe(status);
    return res;
  } catch (e) {
    expect((e as { status?: number }).status).toBe(status);
    return null;
  }
}

const fence = {
  kind: 'fence',
  name: 'Pasture fence',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-77.55, 39.1],
      [-77.549, 39.1],
      [-77.549, 39.101]
    ]
  }
};
const well = {
  kind: 'water_source',
  name: 'Barn well',
  geometry: { type: 'Point', coordinates: [-77.55, 39.1] },
  details: { source: 'well', flowRateGpm: 12 }
};

beforeEach(() => {
  auth.role = 'owner';
});

describe('/api/map-features', () => {
  it('creates a fence with a measured length and a water source with details', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const f = await create(fence);
      expect(f.status).toBe(201);
      const { mapFeature: line } = await f.json();
      expect(line).toMatchObject({ kind: 'fence', name: 'Pasture fence', fieldId: null });
      expect(line.lengthFt).toBeGreaterThan(600);
      expect(line.geometry.type).toBe('LineString');

      const w = await create(well);
      expect(w.status).toBe(201);
      const { mapFeature: point } = await w.json();
      expect(point).toMatchObject({
        kind: 'water_source',
        details: { source: 'well', flowRateGpm: 12 },
        lengthFt: null
      });

      const all = (await (await list()).json()).mapFeatures;
      expect(all.map((x: { id: string }) => x.id)).toEqual([line.id, point.id]);
      const onlyWater = (await (await list('?kind=water_source')).json()).mapFeatures;
      expect(onlyWater).toHaveLength(1);
      expect((await list('?kind=watercourse')).status).toBe(400);
      expect((await getOne(point.id)).status).toBe(200);
    });
  });

  it.each([
    ['a point geometry on a fence', { ...fence, geometry: well.geometry }],
    ['a line on a gate', { ...fence, kind: 'gate' }],
    ['a one-point line', { ...fence, geometry: { type: 'LineString', coordinates: [[0, 0]] } }],
    ['water details on a hydrant', { ...well, kind: 'hydrant' }],
    ['an unknown water source', { ...well, details: { source: 'creek' } }],
    ['a zero flow rate', { ...well, details: { flowRateGpm: 0 } }],
    ['an unknown kind', { ...fence, kind: 'watercourse' }],
    ['a blank name', { ...fence, name: '   ' }],
    ['extra fields', { ...fence, heightFt: 6 }]
  ])('400s on %s and writes nothing', async (_label, body) => {
    await runWithTenantAsync(seedOwner(), async () => {
      expect((await create(body)).status).toBe(400);
      expect((await (await list()).json()).mapFeatures).toEqual([]);
    });
  });

  it('PATCH renames, moves, relinks and clears details, keeping the kind', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const area = fieldsRepo.createField({ name: 'Home Pasture' });
      const { mapFeature } = await (await create(well)).json();
      const res = await patch(mapFeature.id, {
        name: 'Old well',
        geometry: { type: 'Point', coordinates: [-77.56, 39.2] },
        fieldId: area.id,
        details: null
      });
      expect(res.status).toBe(200);
      expect((await res.json()).mapFeature).toMatchObject({
        name: 'Old well',
        kind: 'water_source',
        fieldId: area.id,
        details: null,
        geometry: { type: 'Point', coordinates: [-77.56, 39.2] }
      });
      expect((await patch(mapFeature.id, { kind: 'hydrant' })).status).toBe(400);
      expect(
        (await patch(mapFeature.id, { geometry: fence.geometry })).status
      ).toBe(400);
      expect((await patch(mapFeature.id, { details: { source: 'lake' } })).status).toBe(400);
      expect((await patch('missing', { name: 'x' })).status).toBe(404);
    });
  });

  it('helpers can read but every write is refused', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const { mapFeature } = await (await create(fence)).json();
      auth.role = 'helper';
      expect((await list()).status).toBe(200);
      expect((await getOne(mapFeature.id)).status).toBe(200);
      await expectStatus(() => create(fence), 403);
      await expectStatus(() => patch(mapFeature.id, { name: 'Helper fence' }), 403);
      await expectStatus(() => remove(mapFeature.id), 403);
      auth.role = 'owner';
      expect((await (await getOne(mapFeature.id)).json()).mapFeature.name).toBe('Pasture fence');
    });
  });

  it("refuses another Owner's Area and never touches another Owner's feature", async () => {
    const ownerA = seedOwner();
    const ownerB = seedOwner();
    const bArea = runWithTenant(ownerB, () => fieldsRepo.createField({ name: 'B pasture' }));
    const bFeature = runWithTenant(ownerB, () =>
      mapFeaturesRepo.createMapFeature({
        kind: 'gate',
        name: 'B gate',
        geometry: { type: 'Point', coordinates: [-77.5, 39.1] }
      })
    );
    await runWithTenantAsync(ownerA, async () => {
      const res = await create({ ...fence, fieldId: bArea.id });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'unknown fieldId' });
      const { mapFeature: own } = await (await create(fence)).json();
      const relink = await patch(own.id, { fieldId: bArea.id });
      expect(relink.status).toBe(400);

      expect((await getOne(bFeature.id)).status).toBe(404);
      expect((await patch(bFeature.id, { name: 'hijacked' })).status).toBe(404);
      expect((await remove(bFeature.id)).status).toBe(404);
      expect((await (await list(`?fieldId=${bArea.id}`)).json()).mapFeatures).toEqual([]);
    });
    expect(runWithTenant(ownerB, () => mapFeaturesRepo.getMapFeature(bFeature.id))?.name).toBe(
      'B gate'
    );
  });

  it('DELETE removes one feature; deleting its Area only unlinks it', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const area = fieldsRepo.createField({ name: 'Back pasture' });
      const { mapFeature: linked } = await (await create({ ...fence, fieldId: area.id })).json();
      const { mapFeature: gone } = await (await create(well)).json();

      expect((await remove(gone.id)).status).toBe(200);
      expect((await getOne(gone.id)).status).toBe(404);
      expect((await remove(gone.id)).status).toBe(404);

      deleteFieldCascade(area.id);
      const after = (await (await getOne(linked.id)).json()).mapFeature;
      expect(after.fieldId).toBeNull();
    });
  });
});
