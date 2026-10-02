/**
 * Phase 33C amendment batches, their inputs, bioassays and dismissals.
 * Every read and write goes through the tenant helpers (Invariant 6). None
 * of these tables is a hold fact.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { db } from './client';
import {
  amendmentBatchInputs,
  amendmentBatches,
  amendmentBioassays,
  amendmentDismissals,
  fertilityApplications,
  stockItems,
  stockLots,
  stockMovements
} from './schema';
import { tenantValues, withTenant } from './tenant';
import type { BatchKind, BatchOrigin, InputType, SupplierStatement } from '$lib/amendments/model';

export interface AmendmentBatch {
  id: string;
  kind: BatchKind;
  name: string;
  origin: BatchOrigin;
  supplier: string | null;
  supplierStatement: SupplierStatement | null;
  startedAt: number;
  closedAt: number | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: number;
}

export interface AmendmentBatchInput {
  id: string;
  batchId: string;
  inputType: InputType;
  inputId: string;
  fromAt: number;
  toAt: number | null;
  supplierStatement: SupplierStatement | null;
  createdBy: string | null;
  createdAt: number;
}

export interface AmendmentBioassay {
  id: string;
  batchId: string | null;
  blockId: string | null;
  testedAt: number;
  result: 'no-damage' | 'damage';
  note: string | null;
  createdBy: string | null;
  createdAt: number;
}

export interface AmendmentDismissal {
  id: string;
  fertilityApplicationId: string;
  blockId: string;
  reason: string;
  createdBy: string | null;
  createdAt: number;
}

const ms = (d: Date | null): number | null => (d ? d.getTime() : null);

function toBatch(r: typeof amendmentBatches.$inferSelect): AmendmentBatch {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    origin: r.origin,
    supplier: r.supplier ?? null,
    supplierStatement: r.supplierStatement ?? null,
    startedAt: r.startedAt.getTime(),
    closedAt: ms(r.closedAt),
    notes: r.notes ?? null,
    createdBy: r.createdBy ?? null,
    createdAt: r.createdAt.getTime()
  };
}

function toInput(r: typeof amendmentBatchInputs.$inferSelect): AmendmentBatchInput {
  return {
    id: r.id,
    batchId: r.batchId,
    inputType: r.inputType,
    inputId: r.inputId,
    fromAt: r.fromAt.getTime(),
    toAt: ms(r.toAt),
    supplierStatement: r.supplierStatement ?? null,
    createdBy: r.createdBy ?? null,
    createdAt: r.createdAt.getTime()
  };
}

function toBioassay(r: typeof amendmentBioassays.$inferSelect): AmendmentBioassay {
  return {
    id: r.id,
    batchId: r.batchId ?? null,
    blockId: r.blockId ?? null,
    testedAt: r.testedAt.getTime(),
    result: r.result,
    note: r.note ?? null,
    createdBy: r.createdBy ?? null,
    createdAt: r.createdAt.getTime()
  };
}

function toDismissal(r: typeof amendmentDismissals.$inferSelect): AmendmentDismissal {
  return {
    id: r.id,
    fertilityApplicationId: r.fertilityApplicationId,
    blockId: r.blockId,
    reason: r.reason,
    createdBy: r.createdBy ?? null,
    createdAt: r.createdAt.getTime()
  };
}

// ─── Batches ─────────────────────────────────────────────────────────────

export interface NewBatch {
  kind: BatchKind;
  name: string;
  origin: BatchOrigin;
  supplier?: string | null;
  supplierStatement?: SupplierStatement | null;
  startedAt: number;
  notes?: string | null;
  createdBy: string | null;
}

export function insertBatch(input: NewBatch): AmendmentBatch {
  const bought = input.origin === 'bought';
  const row = db
    .insert(amendmentBatches)
    .values(
      tenantValues({
        id: randomUUID(),
        kind: input.kind,
        name: input.name,
        origin: input.origin,
        supplier: bought ? (input.supplier ?? null) : null,
        supplierStatement: bought ? (input.supplierStatement ?? null) : null,
        startedAt: new Date(input.startedAt),
        notes: input.notes ?? null,
        createdBy: input.createdBy,
        createdAt: new Date()
      })
    )
    .returning()
    .get();
  return toBatch(row);
}

export function getBatch(id: string): AmendmentBatch | undefined {
  const row = db
    .select()
    .from(amendmentBatches)
    .where(withTenant(amendmentBatches, eq(amendmentBatches.id, id)))
    .get();
  return row ? toBatch(row) : undefined;
}

/** Newest first. */
export function listBatches(): AmendmentBatch[] {
  return db
    .select()
    .from(amendmentBatches)
    .where(withTenant(amendmentBatches))
    .orderBy(desc(amendmentBatches.startedAt), desc(amendmentBatches.createdAt))
    .all()
    .map(toBatch);
}

export function countBatches(): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(amendmentBatches)
    .where(withTenant(amendmentBatches))
    .get();
  return Number(row?.n ?? 0);
}

export interface BatchPatch {
  name?: string;
  notes?: string | null;
  closedAt?: number | null;
  supplier?: string | null;
  supplierStatement?: SupplierStatement | null;
}

export function updateBatch(id: string, patch: BatchPatch): AmendmentBatch | undefined {
  const set: Partial<typeof amendmentBatches.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.closedAt !== undefined) {
    set.closedAt = patch.closedAt === null ? null : new Date(patch.closedAt);
  }
  if (patch.supplier !== undefined) set.supplier = patch.supplier;
  if (patch.supplierStatement !== undefined) set.supplierStatement = patch.supplierStatement;
  if (Object.keys(set).length === 0) return getBatch(id);
  const row = db
    .update(amendmentBatches)
    .set(set)
    .where(withTenant(amendmentBatches, eq(amendmentBatches.id, id)))
    .returning()
    .get();
  return row ? toBatch(row) : undefined;
}

// ─── Inputs ──────────────────────────────────────────────────────────────

export interface NewBatchInput {
  batchId: string;
  inputType: InputType;
  inputId: string;
  fromAt: number;
  toAt: number | null;
  supplierStatement: SupplierStatement | null;
  createdBy: string | null;
}

export function findBatchInput(
  key: Pick<NewBatchInput, 'batchId' | 'inputType' | 'inputId' | 'fromAt'>
): AmendmentBatchInput | undefined {
  const row = db
    .select()
    .from(amendmentBatchInputs)
    .where(
      withTenant(
        amendmentBatchInputs,
        eq(amendmentBatchInputs.batchId, key.batchId),
        eq(amendmentBatchInputs.inputType, key.inputType),
        eq(amendmentBatchInputs.inputId, key.inputId),
        eq(amendmentBatchInputs.fromAt, new Date(key.fromAt))
      )
    )
    .get();
  return row ? toInput(row) : undefined;
}

/** Null when the same input was already added on that day (unique index). */
export function insertBatchInput(input: NewBatchInput): AmendmentBatchInput | null {
  const row = db
    .insert(amendmentBatchInputs)
    .values(
      tenantValues({
        id: randomUUID(),
        batchId: input.batchId,
        inputType: input.inputType,
        inputId: input.inputId,
        fromAt: new Date(input.fromAt),
        toAt: input.toAt === null ? null : new Date(input.toAt),
        supplierStatement: input.supplierStatement,
        createdBy: input.createdBy,
        createdAt: new Date()
      })
    )
    .onConflictDoNothing()
    .returning()
    .get();
  return row ? toInput(row) : null;
}

export function getBatchInput(id: string): AmendmentBatchInput | undefined {
  const row = db
    .select()
    .from(amendmentBatchInputs)
    .where(withTenant(amendmentBatchInputs, eq(amendmentBatchInputs.id, id)))
    .get();
  return row ? toInput(row) : undefined;
}

export function deleteBatchInput(id: string): boolean {
  const res = db
    .delete(amendmentBatchInputs)
    .where(withTenant(amendmentBatchInputs, eq(amendmentBatchInputs.id, id)))
    .run();
  return res.changes > 0;
}

export function listBatchInputs(batchId?: string): AmendmentBatchInput[] {
  return db
    .select()
    .from(amendmentBatchInputs)
    .where(
      withTenant(
        amendmentBatchInputs,
        batchId ? eq(amendmentBatchInputs.batchId, batchId) : undefined
      )
    )
    .orderBy(asc(amendmentBatchInputs.fromAt), asc(amendmentBatchInputs.createdAt))
    .all()
    .map(toInput);
}

// ─── Bioassays ───────────────────────────────────────────────────────────

export interface NewBioassay {
  batchId: string | null;
  blockId: string | null;
  testedAt: number;
  result: 'no-damage' | 'damage';
  note: string | null;
  createdBy: string | null;
}

export function insertBioassay(input: NewBioassay): AmendmentBioassay {
  if (!input.batchId === !input.blockId) {
    throw new Error('a bioassay names a batch or a block, not both');
  }
  const row = db
    .insert(amendmentBioassays)
    .values(
      tenantValues({
        id: randomUUID(),
        batchId: input.batchId,
        blockId: input.blockId,
        testedAt: new Date(input.testedAt),
        result: input.result,
        note: input.note,
        createdBy: input.createdBy,
        createdAt: new Date()
      })
    )
    .returning()
    .get();
  return toBioassay(row);
}

export function getBioassay(id: string): AmendmentBioassay | undefined {
  const row = db
    .select()
    .from(amendmentBioassays)
    .where(withTenant(amendmentBioassays, eq(amendmentBioassays.id, id)))
    .get();
  return row ? toBioassay(row) : undefined;
}

export function deleteBioassay(id: string): boolean {
  return (
    db
      .delete(amendmentBioassays)
      .where(withTenant(amendmentBioassays, eq(amendmentBioassays.id, id)))
      .run().changes > 0
  );
}

export function listBioassays(
  opts: { blockId?: string; batchId?: string } = {}
): AmendmentBioassay[] {
  return db
    .select()
    .from(amendmentBioassays)
    .where(
      withTenant(
        amendmentBioassays,
        opts.blockId ? eq(amendmentBioassays.blockId, opts.blockId) : undefined,
        opts.batchId ? eq(amendmentBioassays.batchId, opts.batchId) : undefined
      )
    )
    .orderBy(desc(amendmentBioassays.testedAt), desc(amendmentBioassays.createdAt))
    .all()
    .map(toBioassay);
}

// ─── Dismissals ──────────────────────────────────────────────────────────

export interface NewDismissal {
  fertilityApplicationId: string;
  blockId: string;
  reason: string;
  createdBy: string | null;
}

export function insertDismissal(input: NewDismissal): AmendmentDismissal {
  const row = db
    .insert(amendmentDismissals)
    .values(
      tenantValues({
        id: randomUUID(),
        fertilityApplicationId: input.fertilityApplicationId,
        blockId: input.blockId,
        reason: input.reason,
        createdBy: input.createdBy,
        createdAt: new Date()
      })
    )
    .returning()
    .get();
  return toDismissal(row);
}

export function getDismissal(id: string): AmendmentDismissal | undefined {
  const row = db
    .select()
    .from(amendmentDismissals)
    .where(withTenant(amendmentDismissals, eq(amendmentDismissals.id, id)))
    .get();
  return row ? toDismissal(row) : undefined;
}

export function deleteDismissal(id: string): boolean {
  return (
    db
      .delete(amendmentDismissals)
      .where(withTenant(amendmentDismissals, eq(amendmentDismissals.id, id)))
      .run().changes > 0
  );
}

export function listDismissals(opts: { blockId?: string } = {}): AmendmentDismissal[] {
  return db
    .select()
    .from(amendmentDismissals)
    .where(
      withTenant(
        amendmentDismissals,
        opts.blockId ? eq(amendmentDismissals.blockId, opts.blockId) : undefined
      )
    )
    .orderBy(asc(amendmentDismissals.createdAt))
    .all()
    .map(toDismissal);
}

// ─── Spreads ─────────────────────────────────────────────────────────────

/** Fertility applications that spread a batch. */
export function listBatchSpreads(
  batchId?: string
): Array<{ applicationId: string; blockId: string; occurredAt: number; batchId: string }> {
  return db
    .select({
      applicationId: fertilityApplications.id,
      blockId: fertilityApplications.blockId,
      occurredAt: fertilityApplications.occurredAt,
      batchId: fertilityApplications.amendmentBatchId
    })
    .from(fertilityApplications)
    .where(
      withTenant(
        fertilityApplications,
        batchId
          ? eq(fertilityApplications.amendmentBatchId, batchId)
          : isNotNull(fertilityApplications.amendmentBatchId)
      )
    )
    .orderBy(desc(fertilityApplications.occurredAt))
    .all()
    .map((r) => ({
      applicationId: r.applicationId,
      blockId: r.blockId,
      occurredAt: r.occurredAt.getTime(),
      batchId: r.batchId as string
    }));
}

// ─── Stock lots the chain reads ──────────────────────────────────────────

export interface AmendmentLot {
  id: string;
  stockItemId: string;
  itemName: string;
  category: string;
  lotNumber: string | null;
  supplier: string | null;
  receivedAt: number;
  sourceHayCuttingId: string | null;
}

function lotRows(cond: SQL | undefined): AmendmentLot[] {
  return db
    .select({
      id: stockLots.id,
      stockItemId: stockLots.stockItemId,
      itemName: stockItems.displayName,
      category: stockItems.category,
      lotNumber: stockLots.lotNumber,
      supplier: stockLots.supplier,
      receivedAt: stockLots.receivedAt,
      sourceHayCuttingId: stockLots.sourceHayCuttingId
    })
    .from(stockLots)
    .innerJoin(
      stockItems,
      and(eq(stockItems.id, stockLots.stockItemId), eq(stockItems.ownerId, stockLots.ownerId))
    )
    .where(withTenant(stockLots, cond))
    .orderBy(desc(stockLots.receivedAt))
    .all()
    .map((r) => ({
      ...r,
      lotNumber: r.lotNumber ?? null,
      supplier: r.supplier ?? null,
      receivedAt: r.receivedAt.getTime(),
      sourceHayCuttingId: r.sourceHayCuttingId ?? null
    }));
}

/** One lot with its item's name and category, for input checks. */
export function getAmendmentLot(id: string): AmendmentLot | undefined {
  return lotRows(eq(stockLots.id, id))[0];
}

/** Lots of the given categories (M-38), newest first. */
export function listAmendmentLots(categories: readonly string[]): AmendmentLot[] {
  if (categories.length === 0) return [];
  return lotRows(inArray(stockItems.category, [...categories] as never));
}

/** Lots by id, for naming inputs. */
export function listLotsById(ids: readonly string[]): AmendmentLot[] {
  if (ids.length === 0) return [];
  return lotRows(inArray(stockLots.id, [...ids]));
}

/** Lots made from a hay cutting (M-28, M-39). */
export function listHayLots(): AmendmentLot[] {
  return lotRows(isNotNull(stockLots.sourceHayCuttingId));
}

export interface HayFeedUse {
  movementId: string;
  lotId: string;
  occurredAt: number;
  notes: string | null;
}

/** Feed uses from lots made from a hay cutting. */
export function listHayFeedUses(): HayFeedUse[] {
  return db
    .select({
      movementId: stockMovements.id,
      lotId: stockMovements.stockLotId,
      occurredAt: stockMovements.occurredAt,
      notes: stockMovements.notes
    })
    .from(stockMovements)
    .innerJoin(
      stockLots,
      and(
        eq(stockLots.id, stockMovements.stockLotId),
        eq(stockLots.ownerId, stockMovements.ownerId)
      )
    )
    .where(
      withTenant(
        stockMovements,
        eq(stockMovements.reason, 'animal-feed'),
        isNotNull(stockLots.sourceHayCuttingId)
      )
    )
    .orderBy(asc(stockMovements.occurredAt))
    .all()
    .map((r) => ({ ...r, occurredAt: r.occurredAt.getTime(), notes: r.notes ?? null }));
}
