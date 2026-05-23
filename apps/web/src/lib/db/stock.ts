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
import { db } from './client';
import { stockItems, stockLots, stockMovements } from './schema';
import { tenantValues, tenantWhere, withTenant } from './tenant';

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
  | 'fungicide-event'
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
  cropId?: string;
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
  const items = db.select().from(stockItems).where(tenantWhere(stockItems)).all().map(rowToItem);
  return items.map((item) => withBalance(item));
}

function withBalance(item: StockItem): StockItemWithBalance {
  const lots = db
    .select()
    .from(stockLots)
    .where(withTenant(stockLots, eq(stockLots.stockItemId, item.id)))
    .all();
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
    .where(withTenant(stockMovements, eq(stockMovements.stockLotId, lotId)))
    .get();
  return receivedHundredths + (sum?.total ?? 0);
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
        notes: input.notes ?? null
      })
    )
    .returning()
    .get();

  db.insert(stockMovements)
    .values(
      tenantValues({
        id: randomUUID(),
        stockLotId: lotId,
        occurredAt: new Date(receivedAt),
        deltaHundredths: 0,
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
    .where(withTenant(stockLots, eq(stockLots.stockItemId, stockItemId)))
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
    .where(withTenant(stockLots, eq(stockLots.stockItemId, item.id)))
    .orderBy(desc(stockLots.receivedAt))
    .all();

  let currentHundredths = 0;
  for (const lot of lots) {
    currentHundredths += lotBalanceHundredths(lot.id, lot.receivedQuantityHundredths);
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
          or(isNull(stockLots.expiresAt), gt(stockLots.expiresAt, new Date(now)))
        )
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
          notes: `auto-decrement from ${reason}`
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
