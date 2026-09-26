// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { loadGettingStartedFacts } from '$lib/onboarding/gettingStarted.server';

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
import { DELETE as DELETE_GEOM, PUT as PUT_GEOM } from './[id]/geometry/+server';

function seedOwner(): string {
  const id = `blocks-kind-${randomUUID()}`;
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

const create = (body: unknown) =>
  POST({ request: req('POST', 'http://localhost/api/blocks', body) } as never);
const list = (query = '') => LIST({ url: new URL(`http://localhost/api/blocks${query}`) } as never);
const patch = (id: string, body: unknown) =>
  PATCH({
    params: { id },
    request: req('PATCH', `http://localhost/api/blocks/${id}`, body)
  } as never);

describe('/api/blocks kind + layout', () => {
  it('legacy payloads create kind block', async () => {
    await runWithTenant(seedOwner(), async () => {
      const res = await create({ name: 'North' });
      expect(res.status).toBe(201);
      expect((await res.json()).block).toMatchObject({ kind: 'block' });
    });
  });

  it('creates a positioned bed in a garden', async () => {
    const owner = seedOwner();
    await runWithTenant(owner, async () => {
      const garden = createField({ name: 'G', kind: 'garden', widthFt: 20, lengthFt: 30 });
      const res = await create({
        name: 'Bed 1',
        fieldId: garden.id,
        kind: 'bed',
        widthFt: 4,
        lengthFt: 8,
        xFt: 1.5,
        yFt: 2,
        rotationDeg: 270,
        bedStyle: 'raised'
      });
      expect(res.status).toBe(201);
      expect((await res.json()).block).toMatchObject({
        kind: 'bed',
        fieldId: garden.id,
        xFt: 1.5,
        yFt: 2,
        rotationDeg: 270,
        bedStyle: 'raised'
      });
    });
  });

  it.each([
    ['off-grid rotation', { rotationDeg: 30 }],
    ['negative position', { xFt: -2 }],
    ['unknown kind', { kind: 'plot' }],
    ['unknown bed style', { bedStyle: 'hugel' }]
  ])('POST 400s on %s', async (_label, extra) => {
    await runWithTenant(seedOwner(), async () => {
      expect((await create({ name: 'X', ...extra })).status).toBe(400);
    });
  });

  it("rejects another Owner's Area as the parent", async () => {
    const other = runWithTenant(seedOwner(), () => createField({ name: 'Theirs', kind: 'garden' }));
    await runWithTenant(seedOwner(), async () => {
      const res = await create({ name: 'Bed', kind: 'bed', fieldId: other.id });
      expect(res.status).toBe(400);
    });
  });

  it('PATCH moves, rotates and clears layout', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { block } = await (await create({ name: 'Bed', kind: 'bed', xFt: 0, yFt: 0 })).json();
      const moved = await patch(block.id, { xFt: 6.5, rotationDeg: -90, bedStyle: 'in-ground' });
      expect(moved.status).toBe(200);
      expect((await moved.json()).block).toMatchObject({
        xFt: 6.5,
        yFt: 0,
        rotationDeg: 270,
        bedStyle: 'in-ground'
      });
      const cleared = await (await patch(block.id, { xFt: null, bedStyle: null })).json();
      expect(cleared.block.xFt).toBeUndefined();
      expect(cleared.block.bedStyle).toBeUndefined();
      expect((await patch(block.id, { rotationDeg: 15 })).status).toBe(400);
    });
  });

  it('POST rejects a kind the parent Area cannot hold', async () => {
    await runWithTenant(seedOwner(), async () => {
      const pasture = createField({ name: 'P', kind: 'pasture' });
      const barn = createField({ name: 'B', kind: 'barn' });
      expect((await create({ name: 'Bed', fieldId: pasture.id, kind: 'bed' })).status).toBe(400);
      expect((await create({ name: 'Blk', fieldId: barn.id })).status).toBe(400);
      expect((await create({ name: 'Row', fieldId: pasture.id, kind: 'row' })).status).toBe(201);
    });
  });

  it("POST defaults an omitted kind to the parent Area's default", async () => {
    await runWithTenant(seedOwner(), async () => {
      const garden = createField({ name: 'G', kind: 'garden' });
      const field = createField({ name: 'F', kind: 'field' });
      const inGarden = await (await create({ name: 'Drawn', fieldId: garden.id })).json();
      expect(inGarden.block.kind).toBe('bed');
      expect(loadGettingStartedFacts({ ownerId: 'o', userId: 'user-1' }).hasGardenBed).toBe(true);
      const inField = await (await create({ name: 'Drawn', fieldId: field.id })).json();
      expect(inField.block.kind).toBe('block');
    });
  });

  it('POST rejects layout fields on a plain block or row', async () => {
    await runWithTenant(seedOwner(), async () => {
      const garden = createField({ name: 'G', kind: 'garden' });
      const res = await create({ name: 'Row', fieldId: garden.id, kind: 'row', xFt: 2 });
      expect(res.status).toBe(400);
    });
  });

  it('PATCH clears layout when a bed becomes a block, and checks the parent Area', async () => {
    await runWithTenant(seedOwner(), async () => {
      const garden = createField({ name: 'G', kind: 'garden' });
      const pasture = createField({ name: 'P', kind: 'pasture' });
      const { block } = await (
        await create({
          name: 'Bed',
          fieldId: garden.id,
          kind: 'bed',
          xFt: 1,
          yFt: 2,
          bedStyle: 'raised'
        })
      ).json();
      expect((await patch(block.id, { fieldId: pasture.id })).status).toBe(400);
      expect((await patch(block.id, { kind: 'row', xFt: 3 })).status).toBe(400);
      const res = await patch(block.id, { kind: 'block' });
      expect(res.status).toBe(200);
      const updated = (await res.json()).block;
      expect(updated.kind).toBe('block');
      expect(updated.xFt).toBeUndefined();
      expect(updated.yFt).toBeUndefined();
      expect(updated.bedStyle).toBeUndefined();
    });
  });

  it('GET filters by ?kind', async () => {
    await runWithTenant(seedOwner(), async () => {
      await create({ name: 'Plain' });
      await create({ name: 'Bed', kind: 'bed' });
      const beds = (await (await list('?kind=bed')).json()).blocks;
      expect(beds.map((b: { name: string }) => b.name)).toEqual(['Bed']);
      expect((await list('?kind=garden')).status).toBe(400);
    });
  });

  describe('helper role', () => {
    afterEach(() => {
      auth.role = 'owner';
    });

    const status = async (fn: () => unknown) => {
      try {
        const res = (await fn()) as Response;
        return res.status;
      } catch (e) {
        return (e as { status: number }).status;
      }
    };

    it('403s on PATCH, DELETE and geometry writes, and changes nothing', async () => {
      await runWithTenant(seedOwner(), async () => {
        const { block } = await (await create({ name: 'North' })).json();
        auth.role = 'helper';
        expect(await status(() => patch(block.id, { name: 'Renamed' }))).toBe(403);
        expect(
          await status(() =>
            DELETE({
              params: { id: block.id },
              request: req('DELETE', `http://localhost/api/blocks/${block.id}`)
            } as never)
          )
        ).toBe(403);
        expect(
          await status(() =>
            PUT_GEOM({
              params: { id: block.id },
              request: req('PUT', `http://localhost/api/blocks/${block.id}/geometry`, {
                type: 'Polygon',
                coordinates: []
              })
            } as never)
          )
        ).toBe(403);
        expect(await status(() => DELETE_GEOM({ params: { id: block.id } } as never))).toBe(403);
        auth.role = 'owner';
        const one = await GET_ONE({ params: { id: block.id } } as never);
        expect((await one.json()).block).toMatchObject({ name: 'North' });
      });
    });
  });
});
