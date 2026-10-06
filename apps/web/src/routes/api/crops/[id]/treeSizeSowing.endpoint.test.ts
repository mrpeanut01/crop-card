// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' as string }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'tree-user', role: m.role });
  return {
    currentUser: user,
    requireUser: user,
    requireMutator: () => {
      if (m.role === 'inspector') throw error(403, 'inspector role is read-only');
      return user();
    },
    requireOwner: () => {
      if (m.role !== 'owner') throw error(403, 'owner role required');
      return user();
    }
  };
});

import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenantAsync } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock, getBlock } from '$lib/db/blocks';
import { getCrop } from '$lib/db/crops';
import { POST as ADD_PLANTING } from '../../blocks/[id]/plantings/+server';
import { PATCH as PATCH_CROP } from './+server';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function seedOwner(): string {
  const id = `tree-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'tree-user', email: 'tree@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

async function call(
  handler: unknown,
  path: string,
  method: string,
  opts: { params?: Record<string, string>; body?: unknown } = {}
): Promise<{ status: number; body: Json }> {
  const url = new URL(`http://localhost/api${path}`);
  try {
    const res = await (handler as (e: never) => Promise<Response>)({
      params: opts.params ?? {},
      url,
      request: new Request(url.href, {
        method,
        headers: { 'content-type': 'application/json' },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      }),
      locals: {}
    } as never);
    return { status: res.status, body: (await res.json()) as Json };
  } catch (e) {
    const err = e as { status?: number; body?: Json };
    if (err.status) return { status: err.status, body: err.body ?? {} };
    throw e;
  }
}

function block() {
  const area = createField({ name: 'Orchard', kind: 'orchard' });
  return createBlock({ name: 'Row 1', fieldId: area.id, acres: 0.25 });
}

async function plant(blockId: string, body: Json) {
  return call(ADD_PLANTING, `/blocks/${blockId}/plantings`, 'POST', {
    params: { id: blockId },
    body
  });
}

const patch = (id: string, body: Json) =>
  call(PATCH_CROP, `/crops/${id}`, 'PATCH', { params: { id }, body });

beforeEach(() => {
  m.role = 'owner';
});

describe('#548 tree size on plantings', () => {
  it('saves the tree size from the planting form and changes it last-write-wins', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = block();
      const res = await plant(b.id, { cropPluginId: 'apple-gala', treeSizeClass: 'dwarf' });
      expect(res.status).toBe(201);
      const id = res.body.planting.id as string;
      expect(getCrop(id)?.treeSizeClass).toBe('dwarf');
      expect(getBlock(b.id)?.plantings[0].treeSizeClass).toBe('dwarf');

      const semi = await patch(id, { action: 'set-tree-size', treeSizeClass: 'semi-dwarf' });
      expect(semi.status).toBe(200);
      expect(semi.body.crop.treeSizeClass).toBe('semi-dwarf');
      const notSure = await patch(id, { action: 'set-tree-size', treeSizeClass: null });
      expect(notSure.status).toBe(200);
      expect(getCrop(id)?.treeSizeClass).toBeUndefined();
    });
  });

  it('ignores a tree size on a crop without the table, and refuses one the table lacks', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = block();
      const rye = await plant(b.id, { cropPluginId: 'cereal-rye-cover', treeSizeClass: 'dwarf' });
      expect(getCrop(rye.body.planting.id)?.treeSizeClass).toBeUndefined();
      const bartlett = await plant(b.id, { cropPluginId: 'pear-bartlett' });
      const id = bartlett.body.planting.id as string;
      const refused = await patch(id, { action: 'set-tree-size', treeSizeClass: 'dwarf' });
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('NOT_OFFERED');
      expect((await patch(id, { action: 'set-tree-size', treeSizeClass: 'giant' })).status).toBe(
        400
      );
    });
  });

  it('is owner only', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = block();
      const id = (await plant(b.id, { cropPluginId: 'apple-gala' })).body.planting.id as string;
      m.role = 'helper';
      const res = await patch(id, { action: 'set-tree-size', treeSizeClass: 'dwarf' });
      expect(res.status).toBe(403);
      m.role = 'owner';
      expect(getCrop(id)?.treeSizeClass).toBeUndefined();
    });
  });

  it('another farm cannot see or set it', async () => {
    const a = seedOwner();
    const id = await runWithTenantAsync(a, async () => {
      const b = block();
      return (await plant(b.id, { cropPluginId: 'apple-gala' })).body.planting.id as string;
    });
    await runWithTenantAsync(seedOwner(), async () => {
      const res = await patch(id, { action: 'set-tree-size', treeSizeClass: 'dwarf' });
      expect(res.status).toBe(404);
    });
    await runWithTenantAsync(a, async () => {
      expect(getCrop(id)?.treeSizeClass).toBeUndefined();
    });
  });
});

describe('#555 sowing method on plantings', () => {
  it('saves Drilled from the form and the wizard and can change it', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = block();
      const res = await plant(b.id, { cropPluginId: 'cereal-rye-cover', sowingMethod: 'drilled' });
      const id = res.body.planting.id as string;
      expect(getCrop(id)?.sowingMethod).toBe('drilled');
      const back = await patch(id, { action: 'set-sowing-method', sowingMethod: 'broadcast' });
      expect(back.status).toBe(200);
      expect(getCrop(id)?.sowingMethod).toBe('broadcast');
      await patch(id, { action: 'set-sowing-method', sowingMethod: null });
      expect(getCrop(id)?.sowingMethod).toBeUndefined();
    });
  });

  it('ignores or refuses a method the crop has no rate for', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = block();
      const apple = await plant(b.id, { cropPluginId: 'apple-gala', sowingMethod: 'drilled' });
      const id = apple.body.planting.id as string;
      expect(getCrop(id)?.sowingMethod).toBeUndefined();
      const refused = await patch(id, { action: 'set-sowing-method', sowingMethod: 'drilled' });
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('NOT_OFFERED');
    });
  });

  it('is owner only', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const b = block();
      const id = (await plant(b.id, { cropPluginId: 'cereal-rye-cover' })).body.planting
        .id as string;
      m.role = 'helper';
      expect(
        (await patch(id, { action: 'set-sowing-method', sowingMethod: 'drilled' })).status
      ).toBe(403);
    });
  });
});
