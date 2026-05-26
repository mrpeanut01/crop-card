/**
 * Sprint 4 (#200 / CT-HS-004) — stock_movements ledger invariants.
 *
 * Two assertions:
 *   1. Receiving a lot writes a stock_movements row whose
 *      `delta_hundredths` equals the received quantity (not 0).
 *   2. `getStockItem().onHand` matches `sum(movements.delta_hundredths)`
 *      for the item — the property the audit ledger relies on. Holds
 *      whether the item has just receipts or a mix of receipts + uses.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from './client';
import { stockLots, stockMovements } from './schema';
import { runWithTenant, withTenant } from './tenant';
import { createStockItem, decrementForUse, listStockItems, receiveLot } from './stock';

const TEST_OWNER_ID = 'owner_home_farm';

function uniq(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('stock receipt ledger — Sprint 4 #200', () => {
  it('writes the received quantity as a positive delta on the receipt movement', () =>
    runWithTenant(TEST_OWNER_ID, () => {
      const item = createStockItem({
        category: 'herbicide',
        displayName: uniq('Receipt-ledger probe'),
        defaultUnit: 'gal'
      });
      const lot = receiveLot({
        stockItemId: item.id,
        receivedQuantity: 2.5,
        unit: 'gal',
        lotNumber: 'LOT-001'
      });

      const movements = db
        .select()
        .from(stockMovements)
        .where(withTenant(stockMovements, eq(stockMovements.stockLotId, lot.id)))
        .all();
      expect(movements).toHaveLength(1);
      expect(movements[0].reason).toBe('receipt');
      // 2.5 gal = 250 hundredths (toStorage applies a ×100 scale)
      expect(movements[0].deltaHundredths).toBe(250);
    }));

  it('keeps on_hand = sum(delta_hundredths)/100 after a receipt + a use', () =>
    runWithTenant(TEST_OWNER_ID, () => {
      const item = createStockItem({
        category: 'fertilizer',
        displayName: uniq('Receipt-then-use'),
        defaultUnit: 'lb'
      });
      receiveLot({
        stockItemId: item.id,
        receivedQuantity: 10,
        unit: 'lb',
        lotNumber: 'LOT-A'
      });
      decrementForUse({
        stockItemId: item.id,
        amount: 3,
        unit: 'lb',
        reason: 'planting'
      });

      const enriched = listStockItems().find((i) => i.id === item.id);
      expect(enriched?.onHand).toBeCloseTo(7, 5);

      const total = db
        .select({ total: sql<number>`coalesce(sum(${stockMovements.deltaHundredths}), 0)` })
        .from(stockMovements)
        .where(
          withTenant(
            stockMovements,
            sql`${stockMovements.stockLotId} IN (SELECT id FROM ${stockLots} WHERE stock_item_id = ${item.id})`
          )
        )
        .get();
      // 1000 received - 300 used = 700 hundredths = 7 lb
      expect(total?.total ?? 0).toBe(700);
    }));
});
