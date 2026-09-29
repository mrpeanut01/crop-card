// @vitest-environment node
/**
 * Phase 32D (D4): feed and animal-health stock through the real repo.
 * POST /api/stock/{id}/use (D0-12, D0-13) and the create/update rules for
 * medicated feed (D0-14) and a medicine's library link (D0-15).
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' as string }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'feed-user', role: m.role });
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

vi.mock('$lib/server/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/registry')>();
  const health = new Set(['test-fixture-dewormer']);
  return {
    ...actual,
    getDataKinds: async () => ({
      species: { get: () => undefined, all: () => [] },
      animalHealth: { has: (id: string) => health.has(id), get: () => undefined, all: () => [] }
    })
  };
});

import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenantAsync } from '$lib/db/tenant';
import {
  createStockItem,
  getStockItemWithBalance,
  listMovementsForItem,
  receiveLot
} from '$lib/db/stock';
import { insertAnimalGroup } from '$lib/db/animalGroups';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { POST as USE } from './[id]/use/+server';
import { POST as CREATE } from './+server';
import { PATCH } from './[id]/+server';

function seedOwner(): string {
  const id = `feed-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: 'feed-user', email: 'feed@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function call(
  handler: unknown,
  path: string,
  method: string,
  opts: { params?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: Json }> {
  const url = new URL(`http://localhost/api${path}`);
  try {
    const res = await (handler as (e: never) => Promise<Response>)({
      params: opts.params ?? {},
      url,
      request: new Request(url.href, {
        method,
        headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
      }),
      locals: {}
    } as never);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : {} };
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (!status) throw e;
    return { status, body: {} };
  }
}

const use = (id: string, body: unknown, headers?: Record<string, string>) =>
  call(USE, `/stock/${id}/use`, 'POST', { params: { id }, body, headers });

function bagFeed(lbPerBag?: number) {
  const item = createStockItem({
    category: 'feed',
    displayName: 'Layer pellets',
    defaultUnit: 'bag',
    metadataJson: lbPerBag ? JSON.stringify({ feed: { lbPerBag } }) : undefined
  });
  receiveLot({ stockItemId: item.id, receivedQuantity: 2, unit: 'bag' });
  return item;
}

beforeEach(() => {
  m.role = 'owner';
});

describe('POST /api/stock/{id}/use', () => {
  it('lets a helper take pounds off a bag item as an animal-feed movement', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const item = bagFeed(50);
      m.role = 'helper';
      const res = await use(item.id, { lb: 5 });
      expect(res.status).toBe(201);
      expect(res.body.used).toEqual({ lb: 5, amount: 0.1, unit: 'bag' });
      expect(res.body.onHand).toBeCloseTo(1.9, 5);
      const moves = listMovementsForItem(item.id);
      const fed = moves.find((mv) => mv.reason === 'animal-feed')!;
      expect(fed.delta).toBeCloseTo(-0.1, 5);
      expect(fed.notes).toBe('animal-feed');
      expect(fed.performedById).toBe('feed-user');
    });
  });

  it('links the use to a group through the movement note', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const item = bagFeed(50);
      const g = insertAnimalGroup({
        name: 'Layers',
        speciesId: 'chicken',
        purpose: 'production',
        headCount: 12,
        foodProducing: true
      });
      const res = await use(item.id, { lb: 3, subjectType: 'group', subjectId: g.id });
      expect(res.status).toBe(201);
      const fed = listMovementsForItem(item.id).find((mv) => mv.reason === 'animal-feed')!;
      expect(fed.notes).toBe(`animal-feed:group:${g.id}`);
    });
  });

  it('saves a replayed scoop once', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const item = bagFeed(50);
      const headers = { [CLIENT_RECORD_HEADER]: `feed-${randomUUID()}` };
      expect((await use(item.id, { lb: 10 }, headers)).status).toBe(201);
      const again = await use(item.id, { lb: 10 }, headers);
      expect(again.status).toBe(200);
      expect(again.body.duplicate).toBe(true);
      expect(getStockItemWithBalance(item.id)!.onHand).toBeCloseTo(1.8, 5);
    });
  });

  it('refuses an inspector', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const item = bagFeed(50);
      m.role = 'inspector';
      expect((await use(item.id, { lb: 1 })).status).toBe(403);
    });
  });

  it('only takes feed and bedding', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const item = createStockItem({
        category: 'herbicide',
        displayName: 'Glyphosate',
        defaultUnit: 'lb'
      });
      const res = await use(item.id, { lb: 1 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('NOT_FEED');
    });
  });

  it('asks for lb per bag before a bag item can be used', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const item = bagFeed();
      const res = await use(item.id, { lb: 1 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('NEEDS_LB_PER_BAG');
      expect(getStockItemWithBalance(item.id)!.onHand).toBe(2);
    });
  });

  it('refuses a future date and a subject from another farm', async () => {
    const other = seedOwner();
    let foreignGroup = '';
    await runWithTenantAsync(other, async () => {
      foreignGroup = insertAnimalGroup({
        name: 'Theirs',
        speciesId: 'chicken',
        purpose: 'production',
        headCount: 1,
        foodProducing: true
      }).id;
    });
    await runWithTenantAsync(seedOwner(), async () => {
      const item = bagFeed(50);
      const future = await use(item.id, { lb: 1, occurredAt: Date.now() + 60 * 60 * 1000 });
      expect(future.body.code).toBe('IN_THE_FUTURE');
      const foreign = await use(item.id, {
        lb: 1,
        subjectType: 'group',
        subjectId: foreignGroup
      });
      expect(foreign.status).toBe(400);
      expect(foreign.body.code).toBe('UNKNOWN_SUBJECT');
    });
  });

  it("cannot reach another Owner's stock", async () => {
    let theirs = '';
    await runWithTenantAsync(seedOwner(), async () => {
      theirs = bagFeed(50).id;
    });
    await runWithTenantAsync(seedOwner(), async () => {
      expect((await use(theirs, { lb: 1 })).status).toBe(404);
    });
    await runWithTenantAsync(seedOwner(), async () => {
      expect(listMovementsForItem(theirs)).toEqual([]);
    });
  });

  it('pounds on a lb item come straight off', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const item = createStockItem({
        category: 'bedding',
        displayName: 'Straw',
        defaultUnit: 'lb'
      });
      receiveLot({ stockItemId: item.id, receivedQuantity: 100, unit: 'lb' });
      const res = await use(item.id, { lb: 12.5 });
      expect(res.status).toBe(201);
      expect(res.body.onHand).toBeCloseTo(87.5, 5);
    });
  });
});

describe('creating and editing feed and medicine stock', () => {
  const create = (body: unknown) => call(CREATE, '/stock', 'POST', { body });

  it('refuses medicated feed and points to animal health', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const res = await create({
        category: 'feed',
        displayName: 'Medicated chick starter',
        defaultUnit: 'lb',
        metadataJson: JSON.stringify({ feed: { medicated: true } })
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('MEDICATED_FEED');
      expect(res.body.error).toMatch(/add it as animal-health stock/);
    });
  });

  it('needs lb per bag for a bag item', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const bad = await create({ category: 'feed', displayName: 'Pellets', defaultUnit: 'bag' });
      expect(bad.body.code).toBe('NEEDS_LB_PER_BAG');
      const ok = await create({
        category: 'feed',
        displayName: 'Pellets',
        defaultUnit: 'bag',
        metadataJson: JSON.stringify({ feed: { lbPerBag: 50, scoopLb: 1.5 } })
      });
      expect(ok.status).toBe(201);
    });
  });

  it('feed never links to a library product', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const res = await create({
        category: 'bedding',
        displayName: 'Shavings',
        defaultUnit: 'lb',
        pluginId: 'glyphosate'
      });
      expect(res.body.code).toBe('NO_FEED_PRODUCT');
    });
  });

  it('a medicine only links to a registered animal-health product', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const bad = await create({
        category: 'animal-health',
        displayName: 'Dewormer',
        defaultUnit: 'ml',
        pluginId: 'glyphosate'
      });
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('UNKNOWN_PRODUCT');
      const ok = await create({
        category: 'animal-health',
        displayName: 'Dewormer',
        defaultUnit: 'ml',
        pluginId: 'test-fixture-dewormer'
      });
      expect(ok.status).toBe(201);
    });
  });

  it('a helper cannot create or link a medicine', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const item = createStockItem({
        category: 'animal-health',
        displayName: 'Dewormer',
        defaultUnit: 'ml'
      });
      m.role = 'helper';
      const res = await call(PATCH, `/stock/${item.id}`, 'PATCH', {
        params: { id: item.id },
        body: { pluginId: 'test-fixture-dewormer' }
      });
      expect(res.status).toBe(403);
      expect(
        (await create({ category: 'animal-health', displayName: 'x', defaultUnit: 'ml' })).status
      ).toBe(403);
    });
  });

  it('an edit that turns feed medicated is refused', async () => {
    await runWithTenantAsync(seedOwner(), async () => {
      const item = createStockItem({ category: 'feed', displayName: 'Pellets', defaultUnit: 'lb' });
      const res = await call(PATCH, `/stock/${item.id}`, 'PATCH', {
        params: { id: item.id },
        body: { metadataJson: JSON.stringify({ feed: { medicated: true } }) }
      });
      expect(res.status).toBe(422);
    });
  });
});
