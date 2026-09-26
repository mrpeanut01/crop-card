import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  addPlanting: vi.fn(),
  createStockItem: vi.fn(),
  receiveLot: vi.fn(),
  decrementForUse: vi.fn(),
  getStockItem: vi.fn()
}));

vi.mock('$lib/db/blocks', () => ({
  addPlanting: m.addPlanting,
  getBlock: vi.fn(() => ({ id: 'b1' }))
}));
vi.mock('$lib/db/stock', () => ({
  IncompatibleUnitError: class extends Error {},
  createStockItem: m.createStockItem,
  receiveLot: m.receiveLot,
  decrementForUse: m.decrementForUse,
  getStockItem: m.getStockItem
}));
vi.mock('$lib/server/auth', () => ({ requireOwner: vi.fn(() => ({ id: 'u1', role: 'owner' })) }));
vi.mock('$lib/server/registry', () => ({
  getRegistry: vi.fn(async () => ({
    get: () => ({ plugin: { type: 'crop', displayName: 'Sungold Tomato' } })
  }))
}));

import { POST } from './+server';

function ev(body: unknown) {
  return {
    params: { id: 'b1' },
    request: new Request('http://localhost/api/blocks/b1/plantings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    locals: {}
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.addPlanting.mockReturnValue({ id: 'p1', varietyDisplayName: 'Sungold' });
  m.createStockItem.mockReturnValue({ id: 'stock-new' });
  m.getStockItem.mockReturnValue({ id: 'stock-new', defaultUnit: 'seeds' });
  m.decrementForUse.mockReturnValue({ fulfilled: 24, shortfall: 0 });
});

describe('POST /api/blocks/[id]/plantings purchase', () => {
  it('receives the bought seed into inventory, then plants out of it', async () => {
    const res = await POST(
      ev({
        cropPluginId: 'tomato-sungold',
        varietyDisplayName: 'Sungold',
        quantityPlanted: 24,
        quantityUnit: 'seeds',
        purchase: { quantity: 50, unit: 'seeds' }
      })
    );
    expect(res.status).toBe(201);
    expect(m.createStockItem).toHaveBeenCalledWith({
      category: 'seed',
      displayName: 'Sungold',
      defaultUnit: 'seeds',
      pluginId: 'tomato-sungold'
    });
    expect(m.receiveLot).toHaveBeenCalledWith(
      expect.objectContaining({ stockItemId: 'stock-new', receivedQuantity: 50, unit: 'seeds' })
    );
    expect(m.decrementForUse).toHaveBeenCalledWith(
      expect.objectContaining({ stockItemId: 'stock-new', amount: 24, cropId: 'p1' })
    );
    const body = await res.json();
    expect(body.purchased).toEqual({ stockItemId: 'stock-new' });
    expect(body.decrement).toEqual({ fulfilled: 24, shortfall: 0 });
  });

  it('rejects a request that names seed on hand and a purchase together', async () => {
    const res = await POST(
      ev({
        cropPluginId: 'tomato-sungold',
        stockItemId: 's1',
        purchase: { quantity: 1, unit: 'oz' }
      })
    );
    expect(res.status).toBe(400);
    expect(m.addPlanting).not.toHaveBeenCalled();
  });

  it('rejects a purchase in a unit inventory does not know', async () => {
    const res = await POST(
      ev({ cropPluginId: 'tomato-sungold', purchase: { quantity: 1, unit: 'packets' } })
    );
    expect(res.status).toBe(400);
  });

  it('records the planting without touching stock when no seed is involved', async () => {
    const res = await POST(
      ev({ cropPluginId: 'tomato-sungold', quantityPlanted: 12, quantityUnit: 'count' })
    );
    expect(res.status).toBe(201);
    expect(m.createStockItem).not.toHaveBeenCalled();
    expect(m.decrementForUse).not.toHaveBeenCalled();
  });
});
