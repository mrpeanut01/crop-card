import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db } from './client';
import { owners } from './schema';
import { runWithTenant } from './tenant';
import {
  createStockItem,
  decrementForUse,
  getStockItem,
  listLotsForItem,
  listStockItems,
  LotStatusError,
  receiveLot,
  recordMovement,
  setLotQuantityStatus,
  setOnHandQuantity
} from './stock';

function farm(): string {
  const id = `qs-${randomUUID().slice(0, 8)}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function seedItem() {
  return createStockItem({
    category: 'seed',
    displayName: `Seed ${randomUUID().slice(0, 6)}`,
    defaultUnit: 'seeds',
    pluginId: 'tomato'
  });
}

const itemById = (id: string) => listStockItems().find((i) => i.id === id)!;

describe('ordered and planned lots (#475)', () => {
  it('never count toward on hand, but show as on order and planned', () =>
    runWithTenant(farm(), () => {
      const item = seedItem();
      receiveLot({ stockItemId: item.id, receivedQuantity: 20, unit: 'seeds' });
      receiveLot({
        stockItemId: item.id,
        receivedQuantity: 50,
        unit: 'seeds',
        quantityStatus: 'ordered'
      });
      receiveLot({
        stockItemId: item.id,
        receivedQuantity: 100,
        unit: 'seeds',
        quantityStatus: 'planned'
      });
      const row = itemById(item.id);
      expect(row.onHand).toBe(20);
      expect(row.onOrder).toBe(50);
      expect(row.planned).toBe(100);
      expect(row.lotCount).toBe(3);
    }));

  it('are never drawn down by a use or a manual count', () =>
    runWithTenant(farm(), () => {
      const item = seedItem();
      receiveLot({
        stockItemId: item.id,
        receivedQuantity: 50,
        unit: 'seeds',
        quantityStatus: 'ordered'
      });
      const used = decrementForUse({ stockItemId: item.id, amount: 10, unit: 'seeds' });
      expect(used.fulfilled).toBe(0);
      expect(used.shortfall).toBe(10);
      setOnHandQuantity({ stockItemId: item.id, targetQuantity: 5 });
      const lots = listLotsForItem(item.id);
      const ordered = lots.find((l) => l.quantityStatus === 'ordered')!;
      expect(ordered.balance).toBe(0);
      expect(itemById(item.id).onHand).toBe(5);
      expect(itemById(item.id).onOrder).toBe(50);
    }));

  it('refuse a manual movement until received, so nothing hidden comes off later', () =>
    runWithTenant(farm(), () => {
      const item = seedItem();
      const lot = receiveLot({
        stockItemId: item.id,
        receivedQuantity: 50,
        unit: 'seeds',
        quantityStatus: 'ordered'
      });
      expect(() =>
        recordMovement({ stockLotId: lot.id, delta: -5, unit: 'seeds', reason: 'spill' })
      ).toThrow(LotStatusError);
      setLotQuantityStatus({ lotId: lot.id, quantityStatus: 'existing' });
      expect(itemById(item.id).onHand).toBe(50);
      recordMovement({ stockLotId: lot.id, delta: -5, unit: 'seeds', reason: 'spill' });
      expect(itemById(item.id).onHand).toBe(45);
    }));

  it('become on hand when marked received, with one receipt movement', () =>
    runWithTenant(farm(), () => {
      const item = seedItem();
      const lot = receiveLot({
        stockItemId: item.id,
        receivedQuantity: 50,
        unit: 'seeds',
        quantityStatus: 'planned'
      });
      setLotQuantityStatus({ lotId: lot.id, quantityStatus: 'ordered' });
      expect(itemById(item.id).onOrder).toBe(50);
      const received = setLotQuantityStatus({
        lotId: lot.id,
        quantityStatus: 'existing',
        receivedQuantity: 48
      });
      expect(received.quantityStatus).toBe('existing');
      const row = itemById(item.id);
      expect(row.onHand).toBe(48);
      expect(row.onOrder).toBe(0);
      expect(getStockItem(item.id)).toBeDefined();
    }));

  it('refuses to move an on-hand lot back to ordered', () =>
    runWithTenant(farm(), () => {
      const item = seedItem();
      const lot = receiveLot({ stockItemId: item.id, receivedQuantity: 5, unit: 'seeds' });
      expect(() => setLotQuantityStatus({ lotId: lot.id, quantityStatus: 'ordered' })).toThrow(
        LotStatusError
      );
    }));

  it("cannot reach another Owner's lot", () => {
    const a = farm();
    const b = farm();
    const lot = runWithTenant(a, () => {
      const item = seedItem();
      return receiveLot({
        stockItemId: item.id,
        receivedQuantity: 5,
        unit: 'seeds',
        quantityStatus: 'ordered'
      });
    });
    runWithTenant(b, () => {
      expect(() => setLotQuantityStatus({ lotId: lot.id, quantityStatus: 'existing' })).toThrow(
        'lot not found'
      );
    });
  });
});

describe('planting from ordered or planned seed (#475 review)', () => {
  it('sets the seed aside so it cannot be planned twice or arrive as unused', () =>
    runWithTenant(farm(), () => {
      const item = seedItem();
      const lot = receiveLot({
        stockItemId: item.id,
        receivedQuantity: 50,
        unit: 'seeds',
        quantityStatus: 'ordered'
      });
      const used = decrementForUse({
        stockItemId: item.id,
        amount: 50,
        unit: 'seeds',
        reason: 'planting',
        drawExpected: true
      });
      expect(used.fulfilled).toBe(50);
      expect(used.shortfall).toBe(0);
      expect(itemById(item.id).onOrder).toBe(0);
      setLotQuantityStatus({ lotId: lot.id, quantityStatus: 'existing' });
      expect(itemById(item.id).onHand).toBe(0);
    }));

  it('draws on hand first, then ordered, then planned', () =>
    runWithTenant(farm(), () => {
      const item = seedItem();
      receiveLot({ stockItemId: item.id, receivedQuantity: 10, unit: 'seeds' });
      const ordered = receiveLot({
        stockItemId: item.id,
        receivedQuantity: 40,
        unit: 'seeds',
        quantityStatus: 'ordered'
      });
      receiveLot({
        stockItemId: item.id,
        receivedQuantity: 30,
        unit: 'seeds',
        quantityStatus: 'planned'
      });
      const used = decrementForUse({
        stockItemId: item.id,
        amount: 60,
        unit: 'seeds',
        reason: 'planting',
        drawExpected: true
      });
      expect(used.fulfilled).toBe(60);
      const row = itemById(item.id);
      expect(row.onHand).toBe(0);
      expect(row.onOrder).toBe(0);
      expect(row.planned).toBe(20);
      setLotQuantityStatus({ lotId: ordered.id, quantityStatus: 'existing' });
      expect(itemById(item.id).onHand).toBe(0);
      const more = decrementForUse({
        stockItemId: item.id,
        amount: 30,
        unit: 'seeds',
        reason: 'planting',
        drawExpected: true
      });
      expect(more.fulfilled).toBe(20);
      expect(more.shortfall).toBe(10);
    }));
});
