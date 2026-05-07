/**
 * Stock repo (Phase 8b).
 *
 * Quantities stored as integer hundredths of the SKU's default unit so we
 * never lose precision through receipt → use → adjustment cycles. The
 * public API exposes decimal numbers; conversion happens at the boundary.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { fromHundredths, toHundredths, toStorage, type StockUnit } from '$lib/stock/units';
import { db } from './client';
import { stockItems, stockLots, stockMovements } from './schema';

export type StockCategory =
  | 'herbicide'
  | 'insecticide'
  | 'fungicide'
  | 'fertilizer'
  | 'seed'
  | 'adjuvant'
  | 'fuel'
  | 'part';

export type MovementReason =
  | 'receipt'
  | 'spray-event'
  | 'insecticide-event'
  | 'fertility-application'
  | 'planting'
  | 'adjustment'
  | 'spill'
  | 'expiry';

export interface StockItem {
  id: string;
  pluginId?: string;
  category: StockCategory;
  displayName: string;
  defaultUnit: StockUnit;
  reorderThreshold?: number;
  notes?: string;
}

export interface StockLot {
  id: string;
  stockItemId: string;
  lotNumber?: string;
  expiresAt?: number;
  receivedAt: number;
  receivedQuantity: number;
  receivedCostCents?: number;
  supplier?: string;
  notes?: string;
}

export interface StockMovement {
  id: string;
  stockLotId: string;
  occurredAt: number;
  delta: number;
  reason: MovementReason;
  sprayEventId?: string;
  insecticideEventId?: string;
  fertilityApplicationId?: string;
  performedById?: string;
  notes?: string;
}

export interface StockItemWithBalance extends StockItem {
  onHand: number;
  isLow: boolean;
  earliestExpiry?: number;
  lotCount: number;
}

export interface LotWithBalance extends StockLot {
  balance: number;
  /** Days until expiry, or null if no expiry. Negative = already expired. */
  daysUntilExpiry: number | null;
}

// ─── Items ────────────────────────────────────────────────────────────────

export interface CreateItemInput {
  category: StockCategory;
  displayName: string;
  defaultUnit: StockUnit;
  pluginId?: string;
  reorderThreshold?: number;
  notes?: string;
}

export function createStockItem(input: CreateItemInput): StockItem {
  const id = randomUUID();
  const row = db
    .insert(stockItems)
    .values({
      id,
      category: input.category,
      displayName: input.displayName,
      defaultUnit: input.defaultUnit,
      pluginId: input.pluginId ?? null,
      reorderThresholdHundredths:
        input.reorderThreshold !== undefined ? toHundredths(input.reorderThreshold) : null,
      notes: input.notes ?? null
    })
    .returning()
    .get();
  return rowToItem(row);
}

function rowToItem(row: typeof stockItems.$inferSelect): StockItem {
  return {
    id: row.id,
    pluginId: row.pluginId ?? undefined,
    category: row.category as StockCategory,
    displayName: row.displayName,
    defaultUnit: row.defaultUnit as StockUnit,
    reorderThreshold:
      row.reorderThresholdHundredths !== null
        ? fromHundredths(row.reorderThresholdHundredths)
        : undefined,
    notes: row.notes ?? undefined
  };
}

export function getStockItem(id: string): StockItem | undefined {
  const row = db.select().from(stockItems).where(eq(stockItems.id, id)).get();
  return row ? rowToItem(row) : undefined;
}

export function getStockItemByPluginId(pluginId: string): StockItem | undefined {
  const row = db.select().from(stockItems).where(eq(stockItems.pluginId, pluginId)).get();
  return row ? rowToItem(row) : undefined;
}

/** All items, with on-hand balance + low-stock flag computed in one pass. */
export function listStockItems(): StockItemWithBalance[] {
  const items = db.select().from(stockItems).all().map(rowToItem);
  return items.map((item) => withBalance(item));
}

function withBalance(item: StockItem): StockItemWithBalance {
  const lots = db.select().from(stockLots).where(eq(stockLots.stockItemId, item.id)).all();
  let totalHundredths = 0;
  let earliestExpiry: number | undefined;
  for (const lot of lots) {
    totalHundredths += lotBalanceHundredths(lot.id, lot.receivedQuantityHundredths);
    if (lot.expiresAt) {
      const ts = lot.expiresAt.getTime();
      if (earliestExpiry === undefined || ts < earliestExpiry) earliestExpiry = ts;
    }
  }
  const onHand = fromHundredths(totalHundredths);
  const reorderHundredths =
    item.reorderThreshold !== undefined ? toHundredths(item.reorderThreshold) : null;
  const isLow = reorderHundredths !== null && totalHundredths <= reorderHundredths;
  return {
    ...item,
    onHand,
    isLow,
    earliestExpiry,
    lotCount: lots.length
  };
}

function lotBalanceHundredths(lotId: string, receivedHundredths: number): number {
  const sum = db
    .select({ total: sql<number>`coalesce(sum(${stockMovements.deltaHundredths}), 0)` })
    .from(stockMovements)
    .where(eq(stockMovements.stockLotId, lotId))
    .get();
  return receivedHundredths + (sum?.total ?? 0);
}

// ─── Lots ────────────────────────────────────────────────────────────────

export interface ReceiveLotInput {
  stockItemId: string;
  receivedQuantity: number;
  /** Unit the operator is reading off the bottle. Converted to default unit. */
  unit: StockUnit;
  lotNumber?: string;
  expiresAt?: number;
  supplier?: string;
  receivedCostCents?: number;
  notes?: string;
  performedById?: string;
}

export class IncompatibleUnitError extends Error {
  constructor(from: StockUnit, to: StockUnit) {
    super(`cannot convert ${from} → ${to}`);
    this.name = 'IncompatibleUnitError';
  }
}

export function receiveLot(input: ReceiveLotInput): StockLot {
  const item = getStockItem(input.stockItemId);
  if (!item) throw new Error(`unknown stock item: ${input.stockItemId}`);
  const hundredths = toStorage(input.receivedQuantity, input.unit, item.defaultUnit);
  if (hundredths === null) throw new IncompatibleUnitError(input.unit, item.defaultUnit);
  if (hundredths <= 0) throw new Error('receivedQuantity must be positive');

  const lotId = randomUUID();
  const receivedAt = Date.now();
  const lotRow = db
    .insert(stockLots)
    .values({
      id: lotId,
      stockItemId: input.stockItemId,
      lotNumber: input.lotNumber ?? null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      receivedAt: new Date(receivedAt),
      receivedQuantityHundredths: hundredths,
      receivedCostCents: input.receivedCostCents ?? null,
      supplier: input.supplier ?? null,
      notes: input.notes ?? null
    })
    .returning()
    .get();

  // The receipt itself is a +0 movement so the audit trail shows when the
  // lot landed; the actual quantity lives on stockLots.receivedQuantity.
  db.insert(stockMovements)
    .values({
      id: randomUUID(),
      stockLotId: lotId,
      occurredAt: new Date(receivedAt),
      deltaHundredths: 0,
      reason: 'receipt',
      performedById: input.performedById ?? null,
      notes: 'lot received'
    })
    .run();

  return rowToLot(lotRow);
}

function rowToLot(row: typeof stockLots.$inferSelect): StockLot {
  return {
    id: row.id,
    stockItemId: row.stockItemId,
    lotNumber: row.lotNumber ?? undefined,
    expiresAt: row.expiresAt?.getTime(),
    receivedAt: row.receivedAt.getTime(),
    receivedQuantity: fromHundredths(row.receivedQuantityHundredths),
    receivedCostCents: row.receivedCostCents ?? undefined,
    supplier: row.supplier ?? undefined,
    notes: row.notes ?? undefined
  };
}

export function listLotsForItem(stockItemId: string): LotWithBalance[] {
  const lots = db
    .select()
    .from(stockLots)
    .where(eq(stockLots.stockItemId, stockItemId))
    .orderBy(asc(stockLots.receivedAt))
    .all();
  const now = Date.now();
  return lots.map((row) => {
    const balanceHundredths = lotBalanceHundredths(row.id, row.receivedQuantityHundredths);
    const lot = rowToLot(row);
    return {
      ...lot,
      balance: fromHundredths(balanceHundredths),
      daysUntilExpiry: lot.expiresAt ? Math.floor((lot.expiresAt - now) / 86400000) : null
    };
  });
}

// ─── Movements / decrement ───────────────────────────────────────────────

export interface RecordMovementInput {
  stockLotId: string;
  delta: number;
  unit: StockUnit;
  reason: MovementReason;
  sprayEventId?: string;
  performedById?: string;
  notes?: string;
  occurredAt?: number;
}

export function recordMovement(input: RecordMovementInput): StockMovement {
  const lot = db.select().from(stockLots).where(eq(stockLots.id, input.stockLotId)).get();
  if (!lot) throw new Error(`unknown lot: ${input.stockLotId}`);
  const item = getStockItem(lot.stockItemId);
  if (!item) throw new Error(`stock item missing for lot ${input.stockLotId}`);

  // Convert + preserve sign.
  const sign = input.delta < 0 ? -1 : 1;
  const magnitude = toStorage(Math.abs(input.delta), input.unit, item.defaultUnit);
  if (magnitude === null) throw new IncompatibleUnitError(input.unit, item.defaultUnit);

  const id = randomUUID();
  const row = db
    .insert(stockMovements)
    .values({
      id,
      stockLotId: input.stockLotId,
      occurredAt: new Date(input.occurredAt ?? Date.now()),
      deltaHundredths: sign * magnitude,
      reason: input.reason,
      sprayEventId: input.sprayEventId ?? null,
      performedById: input.performedById ?? null,
      notes: input.notes ?? null
    })
    .returning()
    .get();
  return rowToMovement(row);
}

function rowToMovement(row: typeof stockMovements.$inferSelect): StockMovement {
  return {
    id: row.id,
    stockLotId: row.stockLotId,
    occurredAt: row.occurredAt.getTime(),
    delta: fromHundredths(row.deltaHundredths),
    reason: row.reason as MovementReason,
    sprayEventId: row.sprayEventId ?? undefined,
    insecticideEventId: row.insecticideEventId ?? undefined,
    fertilityApplicationId: row.fertilityApplicationId ?? undefined,
    performedById: row.performedById ?? undefined,
    notes: row.notes ?? undefined
  };
}

export function listMovementsForItem(stockItemId: string, limit = 50): StockMovement[] {
  const lots = db
    .select({ id: stockLots.id })
    .from(stockLots)
    .where(eq(stockLots.stockItemId, stockItemId))
    .all();
  if (lots.length === 0) return [];
  const lotIds = lots.map((l) => l.id);
  return db
    .select()
    .from(stockMovements)
    .where(or(...lotIds.map((id) => eq(stockMovements.stockLotId, id))))
    .orderBy(desc(stockMovements.occurredAt))
    .limit(limit)
    .all()
    .map(rowToMovement);
}

export interface DecrementResult {
  itemId: string;
  requested: number;
  fulfilled: number;
  shortfall: number;
  movements: StockMovement[];
  notes: string[];
}

/**
 * FIFO-decrement against the oldest non-expired lots first.
 * If no lot has stock, creates a synthetic "shortfall" lot? No — we record
 * a negative movement against the most-recently-received lot if any exists,
 * and surface a shortfall amount the operator can reconcile later.
 *
 * If there are zero lots for the item entirely, we skip and report shortfall;
 * the spray-event endpoint surfaces this as a warning, not a block.
 */
export function decrementForUse(input: {
  stockItemId: string;
  amount: number;
  unit: StockUnit;
  sprayEventId?: string;
  insecticideEventId?: string;
  fertilityApplicationId?: string;
  reason?: MovementReason;
  performedById?: string;
  occurredAt?: number;
}): DecrementResult {
  const item = getStockItem(input.stockItemId);
  if (!item) throw new Error(`unknown stock item: ${input.stockItemId}`);
  const requestedHundredths = toStorage(input.amount, input.unit, item.defaultUnit);
  if (requestedHundredths === null) throw new IncompatibleUnitError(input.unit, item.defaultUnit);

  const result: DecrementResult = {
    itemId: item.id,
    requested: input.amount,
    fulfilled: 0,
    shortfall: 0,
    movements: [],
    notes: []
  };

  if (requestedHundredths <= 0) return result;

  const now = input.occurredAt ?? Date.now();
  // Pull lots oldest first; skip already-expired lots so we don't pretend
  // they had usable product.
  const lots = db
    .select()
    .from(stockLots)
    .where(
      and(
        eq(stockLots.stockItemId, item.id),
        or(isNull(stockLots.expiresAt), gt(stockLots.expiresAt, new Date(now)))
      )
    )
    .orderBy(asc(stockLots.receivedAt))
    .all();

  let remaining = requestedHundredths;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const balance = lotBalanceHundredths(lot.id, lot.receivedQuantityHundredths);
    if (balance <= 0) continue;
    const take = Math.min(balance, remaining);
    const id = randomUUID();
    const reason: MovementReason =
      input.reason ??
      (input.insecticideEventId
        ? 'insecticide-event'
        : input.fertilityApplicationId
          ? 'fertility-application'
          : 'spray-event');
    const movement = db
      .insert(stockMovements)
      .values({
        id,
        stockLotId: lot.id,
        occurredAt: new Date(now),
        deltaHundredths: -take,
        reason,
        sprayEventId: input.sprayEventId ?? null,
        insecticideEventId: input.insecticideEventId ?? null,
        fertilityApplicationId: input.fertilityApplicationId ?? null,
        performedById: input.performedById ?? null,
        notes: `auto-decrement from ${reason}`
      })
      .returning()
      .get();
    result.movements.push(rowToMovement(movement));
    remaining -= take;
    result.fulfilled += fromHundredths(take);
  }

  if (remaining > 0) {
    result.shortfall = fromHundredths(remaining);
    result.notes.push(
      `insufficient stock — ${result.shortfall} ${item.defaultUnit} short. Reconcile on /stock/${item.id}.`
    );
  }
  return result;
}

// ─── Alerts ──────────────────────────────────────────────────────────────

export function lowStockItems(): StockItemWithBalance[] {
  return listStockItems().filter((i) => i.isLow && i.reorderThreshold !== undefined);
}

export function expiringSoon(windowDays = 30): Array<{
  item: StockItem;
  lot: LotWithBalance;
}> {
  const out: Array<{ item: StockItem; lot: LotWithBalance }> = [];
  for (const item of listStockItems()) {
    for (const lot of listLotsForItem(item.id)) {
      if (lot.daysUntilExpiry === null) continue;
      if (lot.daysUntilExpiry < 0 || lot.daysUntilExpiry > windowDays) continue;
      if (lot.balance <= 0) continue;
      out.push({ item, lot });
    }
  }
  return out.sort((a, b) => (a.lot.daysUntilExpiry ?? 0) - (b.lot.daysUntilExpiry ?? 0));
}
