/**
 * Hay-cuttings repository.
 *
 * One row per (block, year, cutting #). Tracks the workflow's status,
 * step timestamps, and the decision artifacts (forecast captured at mow,
 * moisture + bale-type at bale). The runtime kernel (lib/hay/engine.ts)
 * decides what to do next; this module just persists.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, max } from 'drizzle-orm';
import { db } from './client';
import { hayCuttings } from './schema';
import type { BaleType, HayStatus } from '$lib/hay/types';

export interface HayCutting {
  id: string;
  blockId: string;
  /** Phase 12: per-crop attribution. */
  cropId?: string;
  cropPluginId: string;
  cuttingNumber: number;
  year: number;
  status: HayStatus;
  mowAt?: number;
  tedAt?: number;
  rakeAt?: number;
  baleAt?: number;
  storedAt?: number;
  baleType?: BaleType;
  balesQuantity?: number;
  baleMoisturePct?: number;
  weatherForecastJson?: string;
  performedById?: string;
  rulesVersion: string;
  notes?: string;
  createdAt: number;
}

function rowToCutting(row: typeof hayCuttings.$inferSelect): HayCutting {
  return {
    id: row.id,
    blockId: row.blockId,
    cropId: row.cropId ?? undefined,
    cropPluginId: row.cropPluginId,
    cuttingNumber: row.cuttingNumber,
    year: row.year,
    status: row.status as HayStatus,
    mowAt: row.mowAt?.getTime(),
    tedAt: row.tedAt?.getTime(),
    rakeAt: row.rakeAt?.getTime(),
    baleAt: row.baleAt?.getTime(),
    storedAt: row.storedAt?.getTime(),
    baleType: (row.baleType as BaleType | null) ?? undefined,
    balesQuantity: row.balesQuantity ?? undefined,
    baleMoisturePct:
      row.baleMoistureHundredths !== null ? row.baleMoistureHundredths / 100 : undefined,
    weatherForecastJson: row.weatherForecastJson ?? undefined,
    performedById: row.performedById ?? undefined,
    rulesVersion: row.rulesVersion,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt.getTime()
  };
}

export interface CreateCuttingInput {
  blockId: string;
  cropId?: string;
  cropPluginId: string;
  year: number;
  cuttingNumber?: number;
  mowAt?: number;
  weatherForecastJson?: string;
  performedById?: string;
  rulesVersion: string;
  notes?: string;
}

export function nextCuttingNumber(blockId: string, year: number): number {
  const row = db
    .select({ n: max(hayCuttings.cuttingNumber) })
    .from(hayCuttings)
    .where(and(eq(hayCuttings.blockId, blockId), eq(hayCuttings.year, year)))
    .get();
  return (row?.n ?? 0) + 1;
}

export function createCutting(input: CreateCuttingInput): HayCutting {
  const id = randomUUID();
  const cuttingNumber = input.cuttingNumber ?? nextCuttingNumber(input.blockId, input.year);
  // mowAt is set at create time → cutting starts in `mowing` phase = "mow
  // just done, drying underway". The kernel sees status=mowing and offers
  // 'ted' (or whatever's next in steps[]) as the next advance.
  const row = db
    .insert(hayCuttings)
    .values({
      id,
      blockId: input.blockId,
      cropId: input.cropId ?? null,
      cropPluginId: input.cropPluginId,
      cuttingNumber,
      year: input.year,
      status: 'mowing',
      mowAt: new Date(input.mowAt ?? Date.now()),
      weatherForecastJson: input.weatherForecastJson ?? null,
      performedById: input.performedById ?? null,
      rulesVersion: input.rulesVersion,
      notes: input.notes ?? null
    })
    .returning()
    .get();
  return rowToCutting(row);
}

export interface AdvanceInput {
  status: HayStatus;
  occurredAt?: number;
  /** Step-specific fields. Caller supplies whichever apply. */
  baleType?: BaleType;
  balesQuantity?: number;
  baleMoisturePct?: number;
  notes?: string;
}

/**
 * Stamp the timestamp matching whichever step the new status implies, then
 * write the new status. The kernel + endpoint validate the transition
 * before calling this.
 */
export function advanceCutting(id: string, input: AdvanceInput): HayCutting {
  const occurredAt = input.occurredAt ?? Date.now();
  const updates: Record<string, unknown> = { status: input.status };

  // Map status → which timestamp this transition just completed.
  // mowing is set at create-time so it doesn't appear here.
  const stampField: Partial<Record<HayStatus, keyof typeof hayCuttings.$inferInsert>> = {
    tedding: 'tedAt',
    raking: 'rakeAt',
    baling: 'baleAt',
    storing: 'storedAt',
    complete: 'storedAt'
  };
  const f = stampField[input.status];
  if (f) updates[f as string] = new Date(occurredAt);

  if (input.baleType) updates.baleType = input.baleType;
  if (input.balesQuantity !== undefined) updates.balesQuantity = input.balesQuantity;
  if (input.baleMoisturePct !== undefined)
    updates.baleMoistureHundredths = Math.round(input.baleMoisturePct * 100);
  if (input.notes !== undefined) updates.notes = input.notes;

  const row = db.update(hayCuttings).set(updates).where(eq(hayCuttings.id, id)).returning().get();
  if (!row) throw new Error(`unknown cutting id: ${id}`);
  return rowToCutting(row);
}

export function abortCutting(id: string, reason?: string): HayCutting {
  const row = db
    .update(hayCuttings)
    .set({ status: 'aborted', notes: reason ?? null })
    .where(eq(hayCuttings.id, id))
    .returning()
    .get();
  if (!row) throw new Error(`unknown cutting id: ${id}`);
  return rowToCutting(row);
}

export function getCutting(id: string): HayCutting | undefined {
  const row = db.select().from(hayCuttings).where(eq(hayCuttings.id, id)).get();
  return row ? rowToCutting(row) : undefined;
}

export function listCuttings(filters: {
  blockId?: string;
  year?: number;
  limit?: number;
}): HayCutting[] {
  const conds = [];
  if (filters.blockId) conds.push(eq(hayCuttings.blockId, filters.blockId));
  if (filters.year !== undefined) conds.push(eq(hayCuttings.year, filters.year));

  let q = db.select().from(hayCuttings).$dynamic();
  if (conds.length > 0) q = q.where(and(...conds));
  q = q.orderBy(desc(hayCuttings.year), asc(hayCuttings.cuttingNumber));
  if (filters.limit) q = q.limit(filters.limit);
  return q.all().map(rowToCutting);
}
