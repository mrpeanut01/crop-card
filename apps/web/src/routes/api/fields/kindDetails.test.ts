// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';

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
  const id = `fields-kind-${randomUUID()}`;
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
  POST({ request: req('POST', 'http://localhost/api/fields', body) } as never);
const list = (query = '') => LIST({ url: new URL(`http://localhost/api/fields${query}`) } as never);
const patch = (id: string, body: unknown) =>
  PATCH({
    params: { id },
    request: req('PATCH', `http://localhost/api/fields/${id}`, body)
  } as never);

describe('/api/fields kind + details', () => {
  it('creates a legacy payload as kind field', async () => {
    await runWithTenant(seedOwner(), async () => {
      const res = await create({ name: 'Back 40' });
      expect(res.status).toBe(201);
      const { field } = await res.json();
      expect(field).toMatchObject({ kind: 'field', details: null });
    });
  });

  it('creates a garden with details and a perimeter', async () => {
    await runWithTenant(seedOwner(), async () => {
      const res = await create({
        name: 'Kitchen Garden',
        kind: 'garden',
        widthFt: 30,
        lengthFt: 40,
        details: { organicStatus: 'organic', irrigation: 'hose' }
      });
      expect(res.status).toBe(201);
      const { field } = await res.json();
      expect(field).toMatchObject({
        kind: 'garden',
        perimeterFt: 140,
        details: { organicStatus: 'organic', irrigation: 'hose' }
      });
    });
  });

  it.each([
    ['details from another kind', { name: 'P', kind: 'pasture', details: { heated: true } }],
    ['bad detail value', { name: 'G', kind: 'garden', details: { irrigation: 'flood' } }],
    ['details on a plain field', { name: 'F', details: { use: 'hay' } }],
    ['unknown kind', { name: 'L', kind: 'location' }]
  ])('400s on %s and writes nothing', async (_label, body) => {
    await runWithTenant(seedOwner(), async () => {
      const res = await create(body);
      expect(res.status).toBe(400);
      expect((await (await list()).json()).fields).toEqual([]);
    });
  });

  it('PATCH validates details against the new kind, or the stored one', async () => {
    await runWithTenant(seedOwner(), async () => {
      const { field } = await (await create({ name: 'A', kind: 'garden' })).json();

      expect((await patch(field.id, { details: { heated: true } })).status).toBe(400);
      const ok = await patch(field.id, { details: { irrigation: 'drip' } });
      expect((await ok.json()).field.details).toEqual({ irrigation: 'drip' });

      expect((await patch(field.id, { kind: 'greenhouse', details: { use: 'hay' } })).status).toBe(
        400
      );
      const gh = await patch(field.id, { kind: 'greenhouse', details: { heated: true } });
      expect((await gh.json()).field).toMatchObject({
        kind: 'greenhouse',
        details: { heated: true }
      });

      const one = await GET_ONE({ params: { id: field.id } } as never);
      expect((await one.json()).field.kind).toBe('greenhouse');
    });
  });

  it('GET filters by ?kind and rejects unknown kinds', async () => {
    await runWithTenant(seedOwner(), async () => {
      await create({ name: 'F' });
      await create({ name: 'G', kind: 'garden' });
      await create({ name: 'B', kind: 'barn' });
      const gardens = (await (await list('?kind=garden,greenhouse')).json()).fields;
      expect(gardens.map((f: { name: string }) => f.name)).toEqual(['G']);
      expect((await list('?kind=places')).status).toBe(400);
      expect((await (await list()).json()).fields).toHaveLength(3);
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
        const { field } = await (await create({ name: 'Crops', kind: 'field' })).json();
        auth.role = 'helper';
        expect(await status(() => patch(field.id, { kind: 'pasture', details: {} }))).toBe(403);
        expect(
          await status(() =>
            DELETE({
              params: { id: field.id },
              request: req('DELETE', `http://localhost/api/fields/${field.id}`)
            } as never)
          )
        ).toBe(403);
        expect(
          await status(() =>
            PUT_GEOM({
              params: { id: field.id },
              request: req('PUT', `http://localhost/api/fields/${field.id}/geometry`, {
                type: 'Polygon',
                coordinates: []
              })
            } as never)
          )
        ).toBe(403);
        expect(await status(() => DELETE_GEOM({ params: { id: field.id } } as never))).toBe(403);
        auth.role = 'owner';
        const one = await GET_ONE({ params: { id: field.id } } as never);
        expect((await one.json()).field).toMatchObject({ name: 'Crops', kind: 'field' });
      });
    });
  });
});
