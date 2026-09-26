/**
 * The set-based stock read (one grouped lots ⟕ movements query, shared by the
 * root layout and the page load) must equal the per-lot computation it
 * replaced, for any mix of items, lots and movements, and must never see
 * another Owner's rows.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from './client';
import { owners, stockItems, stockLots, stockMovements } from './schema';
import { runWithTenant, tenantValues, tenantWhere, withTenant } from './tenant';
import { fromHundredths, toHundredths } from '$lib/stock/units';
import {
  createStockItem,
  expiringSoon,
  listLotsForItem,
  listStockItems,
  lowStockItems,
  receiveLot,
  recordMovement,
  type LotWithBalance,
  type StockItemWithBalance
} from './stock';

const NOW = Date.parse('2026-06-15T15:00:00Z');
const DAY = 86_400_000;

function ensureOwner(id: string): void {
  db.insert(owners)
    .values({ id, name: id, slug: id, billingStatus: 'active' })
    .onConflictDoNothing()
    .run();
}

/** The pre-change implementation: one balance query per lot. */
function referenceLotBalance(lotId: string): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${stockMovements.deltaHundredths}), 0)` })
    .from(stockMovements)
    .where(withTenant(stockMovements, eq(stockMovements.stockLotId, lotId)))
    .get();
  return row?.total ?? 0;
}

function referenceLots(itemId: string): LotWithBalance[] {
  return db
    .select()
    .from(stockLots)
    .where(withTenant(stockLots, eq(stockLots.stockItemId, itemId)))
    .orderBy(asc(stockLots.receivedAt))
    .all()
    .map((row) => {
      const expiresAt = row.expiresAt?.getTime();
      return {
        id: row.id,
        stockItemId: row.stockItemId,
        lotNumber: row.lotNumber ?? undefined,
        expiresAt,
        receivedAt: row.receivedAt.getTime(),
        receivedQuantity: fromHundredths(row.receivedQuantityHundredths),
        receivedCostCents: row.receivedCostCents ?? undefined,
        supplier: row.supplier ?? undefined,
        notes: row.notes ?? undefined,
        balance: fromHundredths(referenceLotBalance(row.id)),
        daysUntilExpiry: expiresAt ? Math.floor((expiresAt - Date.now()) / DAY) : null
      };
    });
}

function referenceItems(): StockItemWithBalance[] {
  const items = db.select().from(stockItems).where(tenantWhere(stockItems)).all();
  return items.map((row) => {
    const lots = db
      .select()
      .from(stockLots)
      .where(withTenant(stockLots, eq(stockLots.stockItemId, row.id)))
      .all();
    let total = 0;
    let earliestExpiry: number | undefined;
    for (const lot of lots) {
      total += referenceLotBalance(lot.id);
      const ts = lot.expiresAt?.getTime();
      if (ts !== undefined && (earliestExpiry === undefined || ts < earliestExpiry))
        earliestExpiry = ts;
    }
    const reorder = row.reorderThresholdHundredths;
    return {
      id: row.id,
      pluginId: row.pluginId ?? undefined,
      category: row.category as StockItemWithBalance['category'],
      displayName: row.displayName,
      shortName: row.shortName ?? undefined,
      defaultUnit: row.defaultUnit as StockItemWithBalance['defaultUnit'],
      reorderThreshold: reorder !== null ? fromHundredths(reorder) : undefined,
      notes: row.notes ?? undefined,
      barcode: row.barcode ?? undefined,
      typeId: row.typeId ?? undefined,
      metadataJson: row.metadataJson ?? undefined,
      activeIngredientsJson: row.activeIngredientsJson ?? undefined,
      formulationJson: row.formulationJson ?? undefined,
      pendingRefreshJson: row.pendingRefreshJson ?? undefined,
      pendingRefreshAt: undefined,
      onHand: fromHundredths(total),
      isLow: reorder !== null && total <= toHundredths(fromHundredths(reorder)),
      earliestExpiry,
      lotCount: lots.length
    };
  });
}

function referenceExpiring(windowDays: number) {
  const out: Array<{ item: StockItemWithBalance; lot: LotWithBalance }> = [];
  for (const item of referenceItems()) {
    for (const lot of referenceLots(item.id)) {
      if (lot.daysUntilExpiry === null) continue;
      if (lot.daysUntilExpiry < 0 || lot.daysUntilExpiry > windowDays) continue;
      if (lot.balance <= 0) continue;
      out.push({ item, lot });
    }
  }
  return out.sort((a, b) => (a.lot.daysUntilExpiry ?? 0) - (b.lot.daysUntilExpiry ?? 0));
}

const lotArb = fc.record({
  expiresInDays: fc.option(fc.integer({ min: -40, max: 60 }), { nil: null }),
  receivedDaysAgo: fc.integer({ min: 0, max: 900 }),
  deltas: fc.array(fc.integer({ min: -20_000, max: 20_000 }), { maxLength: 6 })
});
const itemArb = fc.record({
  reorder: fc.option(fc.integer({ min: 0, max: 30_000 }), { nil: null }),
  lots: fc.array(lotArb, { maxLength: 4 })
});
const farmArb = fc.array(itemArb, { maxLength: 6 });

type FarmData = typeof farmArb extends fc.Arbitrary<infer T> ? T : never;

function seedFarm(ownerId: string, farm: FarmData): void {
  ensureOwner(ownerId);
  runWithTenant(ownerId, () => {
    let seq = 0;
    for (const item of farm) {
      const itemId = randomUUID();
      db.insert(stockItems)
        .values(
          tenantValues({
            id: itemId,
            category: 'herbicide' as const,
            displayName: `item ${itemId.slice(0, 6)}`,
            defaultUnit: 'gal',
            reorderThresholdHundredths: item.reorder
          })
        )
        .run();
      for (const lot of item.lots) {
        const lotId = randomUUID();
        // Distinct receipt times: the old per-item ORDER BY left ties unordered.
        const receivedAt = NOW - lot.receivedDaysAgo * DAY - seq++;
        db.insert(stockLots)
          .values(
            tenantValues({
              id: lotId,
              stockItemId: itemId,
              expiresAt:
                lot.expiresInDays === null ? null : new Date(NOW + lot.expiresInDays * DAY),
              receivedAt: new Date(receivedAt),
              receivedQuantityHundredths: 10_000
            })
          )
          .run();
        for (const delta of lot.deltas) {
          db.insert(stockMovements)
            .values(
              tenantValues({
                id: randomUUID(),
                stockLotId: lotId,
                occurredAt: new Date(receivedAt),
                deltaHundredths: delta,
                reason: 'adjustment' as const
              })
            )
            .run();
        }
      }
    }
  });
}

describe('set-based stock balances', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('match the per-lot computation and never cross Owners', () => {
    fc.assert(
      fc.property(farmArb, farmArb, fc.integer({ min: 0, max: 45 }), (mine, theirs, window) => {
        const me = `stock-set-${randomUUID().slice(0, 8)}`;
        const other = `stock-set-${randomUUID().slice(0, 8)}`;
        seedFarm(me, mine);
        seedFarm(other, theirs);
        runWithTenant(me, () => {
          const items = listStockItems();
          expect(items).toEqual(referenceItems());
          expect(lowStockItems()).toEqual(
            referenceItems().filter((i) => i.isLow && i.reorderThreshold !== undefined)
          );
          expect(expiringSoon(window)).toEqual(referenceExpiring(window));
          for (const item of items)
            expect(listLotsForItem(item.id)).toEqual(referenceLots(item.id));
          const theirIds = runWithTenant(other, () => new Set(listStockItems().map((i) => i.id)));
          for (const i of items) expect(theirIds.has(i.id)).toBe(false);
          for (const { item } of expiringSoon(365)) expect(theirIds.has(item.id)).toBe(false);
        });
      }),
      { numRuns: 30 }
    );
  });

  it('re-reads within a request after a stock write', () => {
    const me = `stock-memo-${randomUUID().slice(0, 8)}`;
    ensureOwner(me);
    runWithTenant(me, () => {
      const item = createStockItem({
        category: 'fungicide',
        displayName: 'memo probe',
        defaultUnit: 'gal',
        reorderThreshold: 1
      });
      const lot = receiveLot({ stockItemId: item.id, receivedQuantity: 5, unit: 'gal' });
      expect(listStockItems().find((i) => i.id === item.id)?.onHand).toBe(5);
      expect(lowStockItems().some((i) => i.id === item.id)).toBe(false);
      recordMovement({ stockLotId: lot.id, delta: -4.5, unit: 'gal', reason: 'adjustment' });
      expect(listStockItems().find((i) => i.id === item.id)?.onHand).toBe(0.5);
      expect(lowStockItems().some((i) => i.id === item.id)).toBe(true);
    });
  });

  it('hands out copies, so a caller cannot change what the next caller sees', () => {
    const me = `stock-copy-${randomUUID().slice(0, 8)}`;
    ensureOwner(me);
    runWithTenant(me, () => {
      const item = createStockItem({ category: 'seed', displayName: 'copy', defaultUnit: 'lb' });
      receiveLot({ stockItemId: item.id, receivedQuantity: 2, unit: 'lb' });
      const first = listStockItems();
      first[0].onHand = 999;
      first.length = 0;
      expect(listStockItems()[0].onHand).toBe(2);
    });
  });
});
