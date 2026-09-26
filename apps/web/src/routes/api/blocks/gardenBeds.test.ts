// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { crops, owners } from '$lib/db/schema';
import { runWithTenant, tenantValues, withTenant } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock, getBlock } from '$lib/db/blocks';

const role = vi.hoisted(() => ({ current: 'owner' as 'owner' | 'helper' }));

vi.mock('$lib/server/auth', async () => {
  const { error } = await import('@sveltejs/kit');
  return {
    currentUser: () => ({ id: 'user-1', role: role.current }),
    requireOwner: () => {
      if (role.current !== 'owner') throw error(403, 'owner role required');
      return { id: 'user-1', role: role.current };
    }
  };
});
vi.mock('$lib/server/session', () => ({ canMutate: () => true }));

import { POST } from './+server';
import { DELETE, PATCH } from './[id]/+server';
import { PATCH as PATCH_FIELD } from '../fields/[id]/+server';
import { getCrop } from '$lib/db/crops';

/** A thrown SvelteKit HttpError settles to the Response the client would get. */
async function settle(call: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await call();
  } catch (e) {
    const err = e as { status?: number; body?: unknown };
    if (typeof err?.status !== 'number') throw e;
    return new Response(JSON.stringify(err.body ?? {}), { status: err.status });
  }
}

function seedOwner(): string {
  const id = `garden-beds-${randomUUID()}`;
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
  settle(() => POST({ request: req('POST', 'http://localhost/api/blocks', body) } as never));
const patch = (id: string, body: unknown) =>
  settle(() =>
    PATCH({
      params: { id },
      request: req('PATCH', `http://localhost/api/blocks/${id}`, body)
    } as never)
  );
const patchField = (id: string, body: unknown) =>
  settle(() =>
    PATCH_FIELD({
      params: { id },
      request: req('PATCH', `http://localhost/api/fields/${id}`, body)
    } as never)
  );
const del = (id: string, query = '?ifEmpty=1') =>
  settle(() =>
    DELETE({ params: { id }, url: new URL(`http://localhost/api/blocks/${id}${query}`) } as never)
  );

function kitchen() {
  const garden = createField({ name: 'Kitchen Garden', kind: 'garden', widthFt: 20, lengthFt: 30 });
  const bed1 = createBlock({
    name: 'Bed 1',
    fieldId: garden.id,
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    xFt: 2,
    yFt: 3,
    rotationDeg: 0,
    bedStyle: 'raised'
  });
  const bed2 = createBlock({
    name: 'Bed 2',
    fieldId: garden.id,
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    xFt: 8,
    yFt: 3,
    rotationDeg: 0,
    bedStyle: 'raised'
  });
  return { garden, bed1, bed2 };
}

describe('/api/blocks garden bed layout', () => {
  beforeEach(() => {
    role.current = 'owner';
  });

  it('refuses a bed that overlaps another or runs past the garden edge', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { garden, bed2 } = kitchen();
      const overlap = await create({
        name: 'Bed 3',
        fieldId: garden.id,
        kind: 'bed',
        widthFt: 4,
        lengthFt: 8,
        xFt: 3,
        yFt: 4
      });
      expect(overlap.status).toBe(409);
      expect(await overlap.json()).toMatchObject({ code: 'OVERLAP' });
      const outside = await create({
        name: 'Bed 3',
        fieldId: garden.id,
        kind: 'bed',
        widthFt: 4,
        lengthFt: 8,
        xFt: 18,
        yFt: 0
      });
      expect(await outside.json()).toMatchObject({ code: 'OUTSIDE_AREA' });
      const moved = await patch(bed2.id, { xFt: 3 });
      expect(moved.status).toBe(409);
      expect(getBlock(bed2.id)).toMatchObject({ xFt: 8 });
      const turned = await patch(bed2.id, { rotationDeg: 90, xFt: 6, yFt: 12 });
      expect(turned.status).toBe(200);
      const edgeToEdge = await create({
        name: 'Bed 3',
        fieldId: garden.id,
        kind: 'bed',
        widthFt: 4,
        lengthFt: 8,
        xFt: 6,
        yFt: 3
      });
      expect(edgeToEdge.status).toBe(201);
    });
  });

  it('lets only the owner change a bed', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { bed1 } = kitchen();
      role.current = 'helper';
      const res = await patch(bed1.id, { xFt: 12 });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ message: 'owner role required' });
      expect((await patch(bed1.id, { name: 'Renamed' })).status).toBe(403);
      expect((await del(bed1.id)).status).toBe(403);
      expect(getBlock(bed1.id)).toMatchObject({ xFt: 2, name: 'Bed 1' });
    });
  });

  it('never lets a helper delete a bed, with or without ifEmpty', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { bed1 } = kitchen();
      db.insert(crops)
        .values(
          tenantValues({
            id: randomUUID(),
            blockId: bed1.id,
            cropPluginId: 'tomato-celebrity-f1',
            varietyDisplayName: 'Tomato',
            status: 'active',
            plantingDate: new Date(Date.UTC(2026, 4, 1))
          })
        )
        .run();
      role.current = 'helper';
      const res = await del(bed1.id, '');
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ message: 'owner role required' });
      expect(getBlock(bed1.id)).toBeDefined();
    });
  });

  it('refuses to shrink a bed past a planting in it, and pulls finished ones inside', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { bed1 } = kitchen();
      const growing = randomUUID();
      const done = randomUUID();
      db.insert(crops)
        .values([
          tenantValues({
            id: growing,
            blockId: bed1.id,
            cropPluginId: 'tomato-celebrity-f1',
            varietyDisplayName: 'Tomato',
            status: 'planned' as const,
            footprintJson: JSON.stringify({ x_in: 24, y_in: 72, w_in: 24, l_in: 24 })
          }),
          tenantValues({
            id: done,
            blockId: bed1.id,
            cropPluginId: 'lettuce-buttercrunch',
            varietyDisplayName: 'Lettuce',
            status: 'harvested' as const,
            footprintJson: JSON.stringify({ x_in: 0, y_in: 48, w_in: 48, l_in: 48 })
          })
        ])
        .run();
      const refused = await patch(bed1.id, { widthFt: 2, lengthFt: 4 });
      expect(refused.status).toBe(409);
      const body = await refused.json();
      expect(body).toMatchObject({ code: 'OUTSIDE_AREA' });
      expect(body.error).toContain('Tomato');
      expect(getBlock(bed1.id)).toMatchObject({ widthFt: 4, lengthFt: 8 });

      db.update(crops)
        .set({ footprintJson: JSON.stringify({ x_in: 0, y_in: 0, w_in: 24, l_in: 24 }) })
        .where(withTenant(crops, eq(crops.id, growing)))
        .run();
      const ok = await patch(bed1.id, { lengthFt: 4 });
      expect(ok.status).toBe(200);
      const fp = getCrop(done)!.footprint!;
      expect(fp.y_in + fp.l_in).toBeLessThanOrEqual(48);
    });
  });

  it('refuses a garden Size its beds no longer fit, and lets only the owner resize it', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { garden } = kitchen();
      role.current = 'helper';
      expect((await patchField(garden.id, { widthFt: 10 })).status).toBe(403);
      role.current = 'owner';
      const res = await patchField(garden.id, { widthFt: 10 });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toMatchObject({ code: 'OUTSIDE_AREA' });
      expect(body.error).toContain('Bed 2');
      expect((await patchField(garden.id, { widthFt: 14 })).status).toBe(200);
    });
  });

  it('a helper cannot rename a plain field block either (owner-only block edits)', async () => {
    await runWithTenant(seedOwner(), async () => {
      const block = createBlock({ name: 'North' });
      role.current = 'helper';
      expect((await patch(block.id, { name: 'North cut' })).status).toBe(403);
      expect(getBlock(block.id)).toMatchObject({ name: 'North' });
    });
  });

  it('deletes an empty bed or one holding only planned plantings', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { bed1 } = kitchen();
      db.insert(crops)
        .values(
          tenantValues({
            id: randomUUID(),
            blockId: bed1.id,
            cropPluginId: 'lettuce-buttercrunch',
            varietyDisplayName: 'Lettuce',
            status: 'planned'
          })
        )
        .run();
      const res = await del(bed1.id);
      expect(res.status).toBe(200);
      expect(getBlock(bed1.id)).toBeUndefined();
    });
  });

  it('deletes a bed holding only a scheduled plan for a future date', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { bed1 } = kitchen();
      db.insert(crops)
        .values(
          tenantValues({
            id: randomUUID(),
            blockId: bed1.id,
            cropPluginId: 'lettuce-buttercrunch',
            varietyDisplayName: 'Lettuce',
            status: 'active',
            plantingDate: new Date(Date.now() + 200 * 86_400_000)
          })
        )
        .run();
      expect((await del(bed1.id)).status).toBe(200);
    });
  });

  it('keeps a bed with an active planting and deletes its empty neighbour', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { bed1, bed2 } = kitchen();
      db.insert(crops)
        .values(
          tenantValues({
            id: randomUUID(),
            blockId: bed1.id,
            cropPluginId: 'tomato-celebrity-f1',
            varietyDisplayName: 'Tomato',
            status: 'active'
          })
        )
        .run();
      const res = await del(bed1.id);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'BED_HAS_RECORDS' });
      expect(getBlock(bed1.id)).toBeDefined();

      expect((await del(bed2.id)).status).toBe(200);
    });
  });
});
