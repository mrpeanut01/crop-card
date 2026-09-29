/**
 * Stock repo (Phase 8b).
 *
 * Quantities stored as integer hundredths of the SKU's default unit so we
 * never lose precision through receipt → use → adjustment cycles. The
 * public API exposes decimal numbers; conversion happens at the boundary.
 *
 * Phase 18a: tenant-scoped. Items, lots, movements all carry an ownerId;
 * decrement queries operate within the active Owner so FIFO ordering across
 * tenants never crosses.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { fromHundredths, toHundredths, toStorage, type StockUnit } from '$lib/stock/units';
import type { QuantityStatus } from '$lib/stock/quantityStatus';
import { db } from './client';
import { stockItems, stockLots, stockMovements } from './schema';
import { preparedOnce, requestMemo } from './requestMemo';
import {
  tenantParams,
  tenantValues,
  tenantWherePrepared,
  withTenant,
  withTenantPrepared
} from './tenant';

export { STOCK_CATEGORIES, type StockCategory } from '$lib/stock/categories';
import type { StockCategory } from '$lib/stock/categories';

export type MovementReason =
  | 'receipt'
  | 'spray-event'
  | 'insecticide-event'
  | 'fungicide-event'
  | 'fertility-application'
  | 'planting'
  | 'adjustment'
  | 'spill'
  | 'expiry'
  | 'animal-treatment'
  | 'animal-feed';

export interface StockItem {
  id: string;
  pluginId?: string;
  category: StockCategory;
  displayName: string;
  shortName?: string;
  defaultUnit: StockUnit;
  reorderThreshold?: number;
  notes?: string;
  barcode?: string;
  typeId?: string;
  metadataJson?: string;
  activeIngredientsJson?: string;
  formulationJson?: string;
  /** Phase 17 follow-up — JSON-serialized pending AI Refresh suggestions
   *  awaiting operator review. Survives modal close + page reload. */
  pendingRefreshJson?: string;
  /** When the pending refresh was captured (ms epoch). */
  pendingRefreshAt?: number;
}

export { QUANTITY_STATUSES, type QuantityStatus } from '$lib/stock/quantityStatus';

export interface StockLot {
  id: string;
  /** `existing` lots are on hand. `ordered` and `planned` lots record an
   *  expected quantity only and never count toward `onHand`. */
  quantityStatus: QuantityStatus;
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
  cropId?: string;
  performedById?: string;
  notes?: string;
}

export interface StockItemWithBalance extends StockItem {
  onHand: number;
  /** Expected quantity on `ordered` lots, not yet received. */
  onOrder: number;
  /** Expected quantity on `planned` lots, not yet bought. */
  planned: number;
  isLow: boolean;
  earliestExpiry?: number;
  lotCount: number;
}

export interface LotWithBalance extends StockLot {
  balance: number;
  daysUntilExpiry: number | null;
}

// ─── Items ────────────────────────────────────────────────────────────────

export interface CreateItemInput {
  category: StockCategory;
  displayName: string;
  shortName?: string;
  defaultUnit: StockUnit;
  pluginId?: string;
  reorderThreshold?: number;
  notes?: string;
  barcode?: string;
  typeId?: string;
  metadataJson?: string;
  activeIngredientsJson?: string;
  formulationJson?: string;
}

export function createStockItem(input: CreateItemInput): StockItem {
  const id = randomUUID();
  const row = db
    .insert(stockItems)
    .values(
      tenantValues({
        id,
        category: input.category,
        displayName: input.displayName,
        shortName: input.shortName?.trim() || null,
        defaultUnit: input.defaultUnit,
        pluginId: input.pluginId ?? null,
        reorderThresholdHundredths:
          input.reorderThreshold !== undefined ? toHundredths(input.reorderThreshold) : null,
        notes: input.notes ?? null,
        barcode: input.barcode ?? null,
        typeId: input.typeId ?? null,
        metadataJson: input.metadataJson ?? null,
        activeIngredientsJson: input.activeIngredientsJson ?? null,
        formulationJson: input.formulationJson ?? null
      })
    )
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
    shortName: row.shortName ?? undefined,
    defaultUnit: row.defaultUnit as StockUnit,
    reorderThreshold:
      row.reorderThresholdHundredths !== null
        ? fromHundredths(row.reorderThresholdHundredths)
        : undefined,
    notes: row.notes ?? undefined,
    barcode: row.barcode ?? undefined,
    typeId: row.typeId ?? undefined,
    metadataJson: row.metadataJson ?? undefined,
    activeIngredientsJson: row.activeIngredientsJson ?? undefined,
    formulationJson: row.formulationJson ?? undefined,
    pendingRefreshJson: row.pendingRefreshJson ?? undefined,
    pendingRefreshAt:
      row.pendingRefreshAt instanceof Date
        ? row.pendingRefreshAt.getTime()
        : ((row.pendingRefreshAt as number | null | undefined) ?? undefined)
  };
}

export function getStockItem(id: string): StockItem | undefined {
  const row = db
    .select()
    .from(stockItems)
    .where(withTenant(stockItems, eq(stockItems.id, id)))
    .get();
  return row ? rowToItem(row) : undefined;
}

export function getStockItemByPluginId(pluginId: string): StockItem | undefined {
  const row = db
    .select()
    .from(stockItems)
    .where(withTenant(stockItems, eq(stockItems.pluginId, pluginId)))
    .get();
  return row ? rowToItem(row) : undefined;
}

export function getStockItemByBarcode(barcode: string): StockItem | undefined {
  const row = db
    .select()
    .from(stockItems)
    .where(withTenant(stockItems, eq(stockItems.barcode, barcode)))
    .get();
  return row ? rowToItem(row) : undefined;
}

export type UpdateItemInput = {
  displayName?: string;
  shortName?: string | null;
  category?: StockCategory;
  defaultUnit?: StockUnit;
  pluginId?: string | null;
  reorderThreshold?: number | null;
  notes?: string;
  barcode?: string;
  typeId?: string | null;
  metadataJson?: string;
  activeIngredientsJson?: string | null;
  formulationJson?: string | null;
};

export function updateStockItem(id: string, updates: UpdateItemInput): StockItem {
  const set: Record<string, unknown> = {};
  if ('displayName' in updates && updates.displayName !== undefined)
    set.displayName = updates.displayName;
  if ('shortName' in updates) set.shortName = updates.shortName ?? null;
  if ('category' in updates && updates.category !== undefined) set.category = updates.category;
  if ('defaultUnit' in updates && updates.defaultUnit !== undefined)
    set.defaultUnit = updates.defaultUnit;
  if ('pluginId' in updates) set.pluginId = updates.pluginId ?? null;
  if ('reorderThreshold' in updates) {
    set.reorderThresholdHundredths =
      updates.reorderThreshold != null ? toHundredths(updates.reorderThreshold) : null;
  }
  if ('notes' in updates) set.notes = updates.notes ?? null;
  if ('barcode' in updates) set.barcode = updates.barcode ?? null;
  if ('typeId' in updates) set.typeId = updates.typeId ?? null;
  if ('metadataJson' in updates) set.metadataJson = updates.metadataJson ?? null;
  if ('activeIngredientsJson' in updates)
    set.activeIngredientsJson = updates.activeIngredientsJson ?? null;
  if ('formulationJson' in updates) set.formulationJson = updates.formulationJson ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = db
    .update(stockItems)
    .set(set as any)
    .where(withTenant(stockItems, eq(stockItems.id, id)))
    .returning()
    .get();
  if (!row) throw new Error(`Stock item ${id} not found`);
  return rowToItem(row);
}

/**
 * Phase 17 follow-up — write or clear the pending AI Refresh blob.
 * `payload === null` clears; otherwise stores the JSON + a timestamp so the
 * UI can label staleness. Kept separate from `updateStockItem` so the
 * refresh endpoints don't have to construct a full update set.
 */
export function setPendingRefresh(id: string, payload: string | null): StockItem {
  const set: Record<string, unknown> = {
    pendingRefreshJson: payload,
    pendingRefreshAt: payload === null ? null : new Date()
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = db
    .update(stockItems)
    .set(set as any)
    .where(withTenant(stockItems, eq(stockItems.id, id)))
    .returning()
    .get();
  if (!row) throw new Error(`Stock item ${id} not found`);
  return rowToItem(row);
}

/** Lightweight list — id + display name + pending-refresh metadata for any
 *  item that currently has an unapplied AI Refresh suggestion. Powers a
 *  "pending suggestions" view in Settings. */
export function listItemsWithPendingRefresh(): Array<{
  id: string;
  displayName: string;
  shortName?: string;
  category: StockCategory;
  pendingRefreshAt: number;
}> {
  return db
    .select({
      id: stockItems.id,
      displayName: stockItems.displayName,
      shortName: stockItems.shortName,
      category: stockItems.category,
      pendingRefreshAt: stockItems.pendingRefreshAt
    })
    .from(stockItems)
    .where(withTenant(stockItems, sql`${stockItems.pendingRefreshJson} IS NOT NULL`))
    .all()
    .map((row) => ({
      id: row.id,
      displayName: row.displayName,
      shortName: row.shortName ?? undefined,
      category: row.category as StockCategory,
      pendingRefreshAt:
        row.pendingRefreshAt instanceof Date
          ? row.pendingRefreshAt.getTime()
          : (row.pendingRefreshAt as unknown as number)
    }));
}

/** All items, with on-hand balance + low-stock flag computed in one pass. */
export function listStockItems(): StockItemWithBalance[] {
  return stockSnapshot().items.map((i) => ({ ...i }));
}

type LotRow = typeof stockLots.$inferSelect;

interface LotBalanceRow {
  lot: LotRow;
  balanceHundredths: number;
}

interface StockSnapshot {
  items: StockItemWithBalance[];
  lotsByItem: Map<string, LotBalanceRow[]>;
}

/** Every lot of the active Owner (or of one item) with its balance summed
 *  from `stock_movements` in one grouped query, oldest receipt first.
 *  Sprint 4 (#200 / CT-HS-004): every receipt is a positive-delta movement,
 *  so the balance is the movement sum alone; `received_quantity_hundredths`
 *  is the denormalized cache that initialized the lot. */
function lotsWithBalancesQuery(byItem: boolean) {
  return db
    .select({
      lot: stockLots,
      balanceHundredths: sql<number>`coalesce(sum(${stockMovements.deltaHundredths}), 0)`
    })
    .from(stockLots)
    .leftJoin(
      stockMovements,
      withTenantPrepared(stockMovements, eq(stockMovements.stockLotId, stockLots.id))
    )
    .where(
      withTenantPrepared(
        stockLots,
        byItem ? eq(stockLots.stockItemId, sql.placeholder('stockItemId')) : undefined
      )
    )
    .groupBy(stockLots.id)
    .orderBy(asc(stockLots.receivedAt), sql`${stockLots}.rowid`)
    .prepare();
}

const allLotsStmt = preparedOnce(() => lotsWithBalancesQuery(false));
const itemLotsStmt = preparedOnce(() => lotsWithBalancesQuery(true));
const allItemsStmt = preparedOnce(() =>
  db.select().from(stockItems).where(tenantWherePrepared(stockItems)).prepare()
);

function lotsWithBalances(stockItemId?: string): LotBalanceRow[] {
  return stockItemId === undefined
    ? allLotsStmt().all(tenantParams())
    : itemLotsStmt().all(tenantParams({ stockItemId }));
}

function computeStockSnapshot(): StockSnapshot {
  const items = allItemsStmt().all(tenantParams()).map(rowToItem);
  const lotsByItem = new Map<string, LotBalanceRow[]>();
  for (const row of lotsWithBalances()) {
    const list = lotsByItem.get(row.lot.stockItemId);
    if (list) list.push(row);
    else lotsByItem.set(row.lot.stockItemId, [row]);
  }
  return {
    items: items.map((item) => withBalance(item, lotsByItem.get(item.id) ?? [])),
    lotsByItem
  };
}

/** Items + lot balances for the active Owner, shared by the root layout and
 *  the page load of one request (see `requestMemo`). Read-only: the public
 *  functions below hand out copies. */
function stockSnapshot(): StockSnapshot {
  return requestMemo('stock.snapshot', computeStockSnapshot);
}

function withBalance(item: StockItem, lots: LotBalanceRow[]): StockItemWithBalance {
  let totalHundredths = 0;
  let orderedHundredths = 0;
  let plannedHundredths = 0;
  let earliestExpiry: number | undefined;
  for (const { lot, balanceHundredths } of lots) {
    if (lot.quantityStatus === 'ordered') {
      orderedHundredths += expectedLeftHundredths(
        lot.receivedQuantityHundredths,
        balanceHundredths
      );
      continue;
    }
    if (lot.quantityStatus === 'planned') {
      plannedHundredths += expectedLeftHundredths(
        lot.receivedQuantityHundredths,
        balanceHundredths
      );
      continue;
    }
    totalHundredths += balanceHundredths;
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
    onOrder: fromHundredths(orderedHundredths),
    planned: fromHundredths(plannedHundredths),
    isLow,
    earliestExpiry,
    lotCount: lots.length
  };
}

/** One lot's balance, read fresh for the write paths below. */
/** An ordered or planned lot has no receipt movement, so its movements are
 *  only plantings that set part of it aside; what is left to plan with is the
 *  expected quantity less those. */
function expectedLeftHundredths(expectedHundredths: number, balanceHundredths: number): number {
  return Math.max(0, expectedHundredths + balanceHundredths);
}

function lotBalanceHundredths(lotId: string): number {
  const sum = db
    .select({ total: sql<number>`coalesce(sum(${stockMovements.deltaHundredths}), 0)` })
    .from(stockMovements)
    .where(withTenant(stockMovements, eq(stockMovements.stockLotId, lotId)))
    .get();
  return sum?.total ?? 0;
}

function toLotWithBalance(row: LotBalanceRow, now: number): LotWithBalance {
  const lot = rowToLot(row.lot);
  return {
    ...lot,
    balance: fromHundredths(row.balanceHundredths),
    daysUntilExpiry: lot.expiresAt ? Math.floor((lot.expiresAt - now) / 86400000) : null
  };
}

// ─── Lots ────────────────────────────────────────────────────────────────

export interface ReceiveLotInput {
  stockItemId: string;
  receivedQuantity: number;
  unit: StockUnit;
  lotNumber?: string;
  expiresAt?: number;
  supplier?: string;
  receivedCostCents?: number;
  notes?: string;
  performedById?: string;
  /** Defaults to `existing`. `ordered` and `planned` lots get no receipt
   *  movement until `markLotReceived`. */
  quantityStatus?: QuantityStatus;
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
  const quantityStatus = input.quantityStatus ?? 'existing';
  const lotRow = db
    .insert(stockLots)
    .values(
      tenantValues({
        id: lotId,
        stockItemId: input.stockItemId,
        lotNumber: input.lotNumber ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        receivedAt: new Date(receivedAt),
        receivedQuantityHundredths: hundredths,
        receivedCostCents: input.receivedCostCents ?? null,
        supplier: input.supplier ?? null,
        notes: input.notes ?? null,
        quantityStatus
      })
    )
    .returning()
    .get();

  if (quantityStatus !== 'existing') return rowToLot(lotRow);

  // Sprint 4 (#200 / CT-HS-004) — the receipt movement now carries the
  // POSITIVE received quantity, not 0. The movement ledger on /stock/[id]
  // accordingly shows "Receipt: +N gal" instead of the previous (correct
  // balance, misleading ledger) "Receipt: 0 gal" line.
  db.insert(stockMovements)
    .values(
      tenantValues({
        id: randomUUID(),
        stockLotId: lotId,
        occurredAt: new Date(receivedAt),
        deltaHundredths: hundredths,
        reason: 'receipt',
        performedById: input.performedById ?? null,
        notes: 'lot received'
      })
    )
    .run();

  return rowToLot(lotRow);
}

function rowToLot(row: typeof stockLots.$inferSelect): StockLot {
  return {
    id: row.id,
    quantityStatus: row.quantityStatus,
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

/** One item with the same on-hand, ordered and planned figures the list,
 *  detail page and planner use: ordered and planned lots never count toward
 *  `onHand`, even after a planting set part of them aside. */
export function getStockItemWithBalance(id: string): StockItemWithBalance | undefined {
  const item = getStockItem(id);
  if (!item) return undefined;
  return withBalance(item, lotsWithBalances(item.id));
}

export function listLotsForItem(stockItemId: string): LotWithBalance[] {
  const now = Date.now();
  return lotsWithBalances(stockItemId).map((row) => toLotWithBalance(row, now));
}

export class LotStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LotStatusError';
  }
}

/** Moves an `ordered` or `planned` lot between those two states, or marks it
 *  received (`existing`), which writes the receipt movement so the expected
 *  quantity (or `receivedQuantity`, when given) becomes on hand. An
 *  `existing` lot never goes back: its balance is ledger history. */
export function setLotQuantityStatus(input: {
  lotId: string;
  quantityStatus: QuantityStatus;
  receivedQuantity?: number;
  performedById?: string;
}): StockLot {
  const lot = db
    .select()
    .from(stockLots)
    .where(withTenant(stockLots, eq(stockLots.id, input.lotId)))
    .get();
  if (!lot) throw new LotStatusError('lot not found');
  if (lot.quantityStatus === input.quantityStatus) return rowToLot(lot);
  if (lot.quantityStatus === 'existing') {
    throw new LotStatusError('a lot already on hand cannot go back to ordered or planned');
  }
  if (input.quantityStatus !== 'existing') {
    const row = db
      .update(stockLots)
      .set({ quantityStatus: input.quantityStatus })
      .where(withTenant(stockLots, eq(stockLots.id, lot.id)))
      .returning()
      .get();
    return rowToLot(row);
  }
  const hundredths =
    input.receivedQuantity !== undefined
      ? toHundredths(input.receivedQuantity)
      : lot.receivedQuantityHundredths;
  if (hundredths <= 0) throw new LotStatusError('receivedQuantity must be positive');
  const now = new Date();
  return db.transaction(() => {
    const row = db
      .update(stockLots)
      .set({ quantityStatus: 'existing', receivedAt: now, receivedQuantityHundredths: hundredths })
      .where(withTenant(stockLots, eq(stockLots.id, lot.id)))
      .returning()
      .get();
    db.insert(stockMovements)
      .values(
        tenantValues({
          id: randomUUID(),
          stockLotId: lot.id,
          occurredAt: now,
          deltaHundredths: hundredths,
          reason: 'receipt',
          performedById: input.performedById ?? null,
          notes: `lot received (was ${lot.quantityStatus})`
        })
      )
      .run();
    return rowToLot(row);
  });
}

// ─── Movements / decrement ───────────────────────────────────────────────

export interface RecordMovementInput {
  stockLotId: string;
  delta: number;
  unit: StockUnit;
  reason: MovementReason;
  sprayEventId?: string;
  cropId?: string;
  performedById?: string;
  notes?: string;
  occurredAt?: number;
}

export function recordMovement(input: RecordMovementInput): StockMovement {
  const lot = db
    .select()
    .from(stockLots)
    .where(withTenant(stockLots, eq(stockLots.id, input.stockLotId)))
    .get();
  if (!lot) throw new Error(`unknown lot: ${input.stockLotId}`);
  if ((lot.quantityStatus ?? 'existing') !== 'existing') {
    throw new LotStatusError(
      'This lot is not on hand yet. Mark it received before recording a change.'
    );
  }
  const item = getStockItem(lot.stockItemId);
  if (!item) throw new Error(`stock item missing for lot ${input.stockLotId}`);

  const sign = input.delta < 0 ? -1 : 1;
  const magnitude = toStorage(Math.abs(input.delta), input.unit, item.defaultUnit);
  if (magnitude === null) throw new IncompatibleUnitError(input.unit, item.defaultUnit);

  const id = randomUUID();
  const row = db
    .insert(stockMovements)
    .values(
      tenantValues({
        id,
        stockLotId: input.stockLotId,
        occurredAt: new Date(input.occurredAt ?? Date.now()),
        deltaHundredths: sign * magnitude,
        reason: input.reason,
        sprayEventId: input.sprayEventId ?? null,
        cropId: input.cropId ?? null,
        performedById: input.performedById ?? null,
        notes: input.notes ?? null
      })
    )
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
    cropId: row.cropId ?? undefined,
    performedById: row.performedById ?? undefined,
    notes: row.notes ?? undefined
  };
}

export function listMovementsForItem(stockItemId: string, limit = 50): StockMovement[] {
  const lots = db
    .select({ id: stockLots.id })
    .from(stockLots)
    .where(withTenant(stockLots, eq(stockLots.stockItemId, stockItemId)))
    .all();
  if (lots.length === 0) return [];
  const lotIds = lots.map((l) => l.id);
  return db
    .select()
    .from(stockMovements)
    .where(withTenant(stockMovements, or(...lotIds.map((id) => eq(stockMovements.stockLotId, id)))))
    .orderBy(desc(stockMovements.occurredAt))
    .limit(limit)
    .all()
    .map(rowToMovement);
}

export interface SetQuantityInput {
  stockItemId: string;
  targetQuantity: number;
  performedById?: string;
  notes?: string;
}

export interface SetQuantityResult {
  itemId: string;
  previousQuantity: number;
  newQuantity: number;
  delta: number;
  movement?: StockMovement;
  lot?: StockLot;
}

export function setOnHandQuantity(input: SetQuantityInput): SetQuantityResult {
  const item = getStockItem(input.stockItemId);
  if (!item) throw new Error(`unknown stock item: ${input.stockItemId}`);
  if (input.targetQuantity < 0) throw new Error('targetQuantity must be ≥ 0');

  const targetHundredths = toHundredths(input.targetQuantity);
  const lots = db
    .select()
    .from(stockLots)
    .where(
      withTenant(
        stockLots,
        and(eq(stockLots.stockItemId, item.id), eq(stockLots.quantityStatus, 'existing'))
      )
    )
    .orderBy(desc(stockLots.receivedAt))
    .all();

  let currentHundredths = 0;
  for (const lot of lots) {
    currentHundredths += lotBalanceHundredths(lot.id);
  }
  const deltaHundredths = targetHundredths - currentHundredths;
  const result: SetQuantityResult = {
    itemId: item.id,
    previousQuantity: fromHundredths(currentHundredths),
    newQuantity: input.targetQuantity,
    delta: fromHundredths(deltaHundredths)
  };
  if (deltaHundredths === 0) return result;

  if (lots.length === 0) {
    const lot = receiveLot({
      stockItemId: item.id,
      receivedQuantity: input.targetQuantity,
      unit: item.defaultUnit,
      performedById: input.performedById,
      notes: input.notes ?? 'manual count'
    });
    result.lot = lot;
    return result;
  }

  const targetLot = lots[0];
  const movementId = randomUUID();
  const row = db
    .insert(stockMovements)
    .values(
      tenantValues({
        id: movementId,
        stockLotId: targetLot.id,
        occurredAt: new Date(),
        deltaHundredths,
        reason: 'adjustment',
        performedById: input.performedById ?? null,
        notes: input.notes ?? 'manual count'
      })
    )
    .returning()
    .get();
  result.movement = rowToMovement(row);
  return result;
}

export interface DecrementResult {
  itemId: string;
  requested: number;
  fulfilled: number;
  shortfall: number;
  movements: StockMovement[];
  notes: string[];
}

export function decrementForUse(input: {
  stockItemId: string;
  amount: number;
  unit: StockUnit;
  sprayEventId?: string;
  insecticideEventId?: string;
  fungicideEventId?: string;
  fertilityApplicationId?: string;
  cropId?: string;
  reason?: MovementReason;
  performedById?: string;
  occurredAt?: number;
  /** Plantings only: after on-hand lots, set aside seed from ordered and then
   *  planned lots, so it cannot be planned twice and arrives already used. */
  drawExpected?: boolean;
  notes?: string;
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
  const lots = db
    .select()
    .from(stockLots)
    .where(
      withTenant(
        stockLots,
        and(
          eq(stockLots.stockItemId, item.id),
          eq(stockLots.quantityStatus, 'existing'),
          or(isNull(stockLots.expiresAt), gt(stockLots.expiresAt, new Date(now)))
        )
      )
    )
    .orderBy(asc(stockLots.receivedAt))
    .all();

  const expectedLots = input.drawExpected
    ? (['ordered', 'planned'] as const).flatMap((status) =>
        db
          .select()
          .from(stockLots)
          .where(
            withTenant(
              stockLots,
              and(eq(stockLots.stockItemId, item.id), eq(stockLots.quantityStatus, status))
            )
          )
          .orderBy(asc(stockLots.receivedAt))
          .all()
      )
    : [];

  let remaining = requestedHundredths;
  for (const lot of [...lots, ...expectedLots]) {
    if (remaining <= 0) break;
    const expected = lot.quantityStatus !== 'existing';
    const movementSum = lotBalanceHundredths(lot.id);
    const balance = expected
      ? expectedLeftHundredths(lot.receivedQuantityHundredths, movementSum)
      : movementSum;
    if (balance <= 0) continue;
    const take = Math.min(balance, remaining);
    const id = randomUUID();
    const reason: MovementReason =
      input.reason ??
      (input.insecticideEventId
        ? 'insecticide-event'
        : input.fungicideEventId
          ? 'fungicide-event'
          : input.fertilityApplicationId
            ? 'fertility-application'
            : 'spray-event');
    const movement = db
      .insert(stockMovements)
      .values(
        tenantValues({
          id,
          stockLotId: lot.id,
          occurredAt: new Date(now),
          deltaHundredths: -take,
          reason,
          sprayEventId: input.sprayEventId ?? null,
          insecticideEventId: input.insecticideEventId ?? null,
          fungicideEventId: input.fungicideEventId ?? null,
          fertilityApplicationId: input.fertilityApplicationId ?? null,
          cropId: input.cropId ?? null,
          performedById: input.performedById ?? null,
          notes:
            input.notes ??
            (expected
              ? `set aside for ${reason} before the lot was received`
              : `auto-decrement from ${reason}`)
        })
      )
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
  item: StockItemWithBalance;
  lot: LotWithBalance;
}> {
  const { items, lotsByItem } = stockSnapshot();
  const now = Date.now();
  const out: Array<{ item: StockItemWithBalance; lot: LotWithBalance }> = [];
  for (const item of items) {
    for (const row of lotsByItem.get(item.id) ?? []) {
      const lot = toLotWithBalance(row, now);
      if (lot.daysUntilExpiry === null) continue;
      if (lot.daysUntilExpiry < 0 || lot.daysUntilExpiry > windowDays) continue;
      if (lot.balance <= 0) continue;
      out.push({ item: { ...item }, lot });
    }
  }
  return out.sort((a, b) => (a.lot.daysUntilExpiry ?? 0) - (b.lot.daysUntilExpiry ?? 0));
}
