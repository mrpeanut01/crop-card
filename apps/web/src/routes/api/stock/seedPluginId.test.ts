/**
 * Seed items require a pluginId (#335).
 *
 * The create schema previously left `pluginId` optional for every category,
 * so a `category:'seed'` SKU could be created with no plugin link (only the
 * client enforced it). A `.refine()` now gates it server-side: seed → 400
 * without a non-empty pluginId; every other category is unaffected.
 *
 * `requireOwner` + `createStockItem` are mocked so the test targets the
 * schema gate in isolation, with no auth or DB dependency.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const { requireOwner, createStockItem } = vi.hoisted(() => ({
  requireOwner: vi.fn(),
  createStockItem: vi.fn((data: Record<string, unknown>) => ({ id: 'sku-1', ...data }))
}));

vi.mock('$lib/server/auth', () => ({ requireOwner }));
vi.mock('$lib/db/stock', () => ({ createStockItem, listStockItems: vi.fn(() => []) }));

import { POST } from './+server';

function makeEvent(body: unknown) {
  return {
    request: new Request('http://localhost/api/stock', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as never;
}

const seedBase = {
  category: 'seed',
  displayName: 'Silver Queen Sweet Corn',
  defaultUnit: 'lb'
};

beforeEach(() => {
  requireOwner.mockReset();
  createStockItem.mockClear();
});

describe('seed pluginId gate (#335)', () => {
  it('seed without pluginId → 400, no create attempted', async () => {
    const res = await POST(makeEvent(seedBase));
    expect(res.status).toBe(400);
    expect(createStockItem).not.toHaveBeenCalled();
  });

  it('seed with empty pluginId → 400', async () => {
    const res = await POST(makeEvent({ ...seedBase, pluginId: '' }));
    expect(res.status).toBe(400);
    expect(createStockItem).not.toHaveBeenCalled();
  });

  it('seed with a non-empty pluginId → 201', async () => {
    const res = await POST(makeEvent({ ...seedBase, pluginId: 'corn-silver-queen' }));
    expect(res.status).toBe(201);
    expect(createStockItem).toHaveBeenCalledOnce();
  });

  it('non-seed category with no pluginId is unaffected → 201', async () => {
    const res = await POST(
      makeEvent({ category: 'fuel', displayName: 'Off-road diesel', defaultUnit: 'gal' })
    );
    expect(res.status).toBe(201);
    expect(createStockItem).toHaveBeenCalledOnce();
  });
});
