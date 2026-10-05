/**
 * Invariant 8: inventory and equipment mutations gate at the API layer.
 * Deleting an item, a lot or a piece of equipment is owner only, like
 * creating and editing them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'helper',
  deleteStockItemCascade: vi.fn(() => ({ removed: { stock_items: 1 } })),
  deleteStockLotCascade: vi.fn(() => ({ removed: { stock_lots: 1 } })),
  deleteEquipmentCascade: vi.fn(() => ({ removed: { equipment: 1 } })),
  equipmentHasSprayRecords: vi.fn(() => false)
}));

vi.mock('$lib/server/auth', async () => {
  const { error } = await import('@sveltejs/kit');
  return {
    currentUser: () => ({ id: 'u', role: m.role }),
    requireOwner: () => {
      if (m.role !== 'owner') throw error(403, 'owner role required');
      return { id: 'u', role: m.role };
    }
  };
});
vi.mock('$lib/db/admin', () => ({
  deleteStockItemCascade: m.deleteStockItemCascade,
  deleteStockLotCascade: m.deleteStockLotCascade,
  deleteEquipmentCascade: m.deleteEquipmentCascade,
  equipmentHasSprayRecords: m.equipmentHasSprayRecords
}));
vi.mock('$lib/db/stock', () => ({
  getStockItem: vi.fn(() => ({ id: 'sku' })),
  listLotsForItem: vi.fn(() => [{ id: 'lot-1' }]),
  listMovementsForItem: vi.fn(() => []),
  updateStockItem: vi.fn(),
  setLotQuantityStatus: vi.fn(),
  LotStatusError: class extends Error {},
  QUANTITY_STATUSES: ['existing', 'ordered', 'planned']
}));
vi.mock('$lib/db/equipment', () => ({
  getEquipment: vi.fn(() => ({ id: 'eq', type: 'sprayer' })),
  appendEquipmentLog: vi.fn(),
  listEquipmentLog: vi.fn(() => []),
  updateEquipment: vi.fn(),
  updateEquipmentState: vi.fn()
}));

import { DELETE as deleteItem } from './[id]/+server';
import { DELETE as deleteLot } from './[id]/lots/[lotId]/+server';
import { DELETE as deleteEquipment } from '../equipment/[id]/+server';

async function settle(call: () => Response | Promise<Response>): Promise<number> {
  try {
    return (await call()).status;
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (typeof status !== 'number') throw e;
    return status;
  }
}

const ev = (params: Record<string, string>) => ({ params, locals: { locale: 'en' } }) as never;

describe('owner-only inventory and equipment deletes', () => {
  beforeEach(() => {
    m.deleteStockItemCascade.mockClear();
    m.deleteStockLotCascade.mockClear();
    m.deleteEquipmentCascade.mockClear();
    m.equipmentHasSprayRecords.mockReturnValue(false);
  });

  it('refuses a helper on every delete', async () => {
    m.role = 'helper';
    expect(await settle(() => deleteItem(ev({ id: 'sku' })))).toBe(403);
    expect(await settle(() => deleteLot(ev({ id: 'sku', lotId: 'lot-1' })))).toBe(403);
    expect(await settle(() => deleteEquipment(ev({ id: 'eq' })))).toBe(403);
    expect(m.deleteStockItemCascade).not.toHaveBeenCalled();
    expect(m.deleteStockLotCascade).not.toHaveBeenCalled();
    expect(m.deleteEquipmentCascade).not.toHaveBeenCalled();
  });

  it('lets the owner delete, and 404s a lot of another item', async () => {
    m.role = 'owner';
    expect(await settle(() => deleteItem(ev({ id: 'sku' })))).toBe(200);
    expect(await settle(() => deleteLot(ev({ id: 'sku', lotId: 'lot-1' })))).toBe(200);
    expect(await settle(() => deleteLot(ev({ id: 'sku', lotId: 'other' })))).toBe(404);
    expect(await settle(() => deleteEquipment(ev({ id: 'eq' })))).toBe(200);
  });

  it('keeps a sprayer that spray records name', async () => {
    m.role = 'owner';
    m.equipmentHasSprayRecords.mockReturnValue(true);
    expect(await settle(() => deleteEquipment(ev({ id: 'eq' })))).toBe(409);
    expect(m.deleteEquipmentCascade).not.toHaveBeenCalled();
  });
});
