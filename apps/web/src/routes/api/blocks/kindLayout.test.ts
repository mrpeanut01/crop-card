// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';

vi.mock('$lib/server/auth', () => ({
  currentUser: () => ({ id: 'user-1', role: 'owner' }),
  requireOwner: () => ({ id: 'user-1', role: 'owner' })
}));
vi.mock('$lib/server/session', () => ({ canMutate: () => true }));

import { GET as LIST, POST } from './+server';
import { PATCH } from './[id]/+server';

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

  it('GET filters by ?kind', async () => {
    await runWithTenant(seedOwner(), async () => {
      await create({ name: 'Plain' });
      await create({ name: 'Bed', kind: 'bed' });
      const beds = (await (await list('?kind=bed')).json()).blocks;
      expect(beds.map((b: { name: string }) => b.name)).toEqual(['Bed']);
      expect((await list('?kind=garden')).status).toBe(400);
    });
  });
});
