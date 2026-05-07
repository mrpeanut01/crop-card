/**
 * Crops repository (Phase 12). A "Crop" = an active planting on a block,
 * analogous to a Brewfather Batch. The legacy `plantingRecords` export is
 * kept as a deprecated alias in schema.ts; new code uses `crops`.
 */

import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from './client';
import { crops } from './schema';

export type CropStatus = 'planned' | 'active' | 'harvested' | 'failed' | 'archived';

export interface Crop {
  id: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  plantingDate: number;
  status: CropStatus;
  harvestedAt?: number;
  archivedAt?: number;
}

function rowToCrop(row: typeof crops.$inferSelect): Crop {
  return {
    id: row.id,
    blockId: row.blockId,
    cropPluginId: row.cropPluginId,
    varietyDisplayName: row.varietyDisplayName,
    plantingDate: row.plantingDate.getTime(),
    status: row.status as CropStatus,
    harvestedAt: row.harvestedAt?.getTime(),
    archivedAt: row.archivedAt?.getTime()
  };
}

export interface ListFilters {
  blockId?: string;
  status?: CropStatus;
  year?: number;
  limit?: number;
}

export function listCrops(filters: ListFilters = {}): Crop[] {
  const conds = [];
  if (filters.blockId) conds.push(eq(crops.blockId, filters.blockId));
  if (filters.status) conds.push(eq(crops.status, filters.status));
  if (filters.year !== undefined) {
    const start = new Date(filters.year, 0, 1);
    const end = new Date(filters.year + 1, 0, 1);
    conds.push(gte(crops.plantingDate, start));
    conds.push(lte(crops.plantingDate, end));
  }

  let q = db.select().from(crops).$dynamic();
  if (conds.length > 0) q = q.where(and(...conds));
  q = q.orderBy(desc(crops.plantingDate));
  if (filters.limit) q = q.limit(filters.limit);
  return q.all().map(rowToCrop);
}

export function getCrop(id: string): Crop | undefined {
  const row = db.select().from(crops).where(eq(crops.id, id)).get();
  return row ? rowToCrop(row) : undefined;
}

export function updateStatus(id: string, status: CropStatus, occurredAt?: number): Crop {
  const updates: Record<string, unknown> = { status };
  const now = occurredAt ?? Date.now();
  if (status === 'harvested') updates.harvestedAt = new Date(now);
  if (status === 'archived') updates.archivedAt = new Date(now);
  const row = db.update(crops).set(updates).where(eq(crops.id, id)).returning().get();
  if (!row) throw new Error(`unknown crop id: ${id}`);
  return rowToCrop(row);
}

/**
 * Backfill helper used by the migration script and as an event-API fallback.
 * Picks the most-recently-planted active/harvested crop on `blockId` whose
 * `plantingDate <= occurredAt`. Returns undefined if no crop matches.
 */
export function inferCropForEvent(blockId: string, occurredAt: number): Crop | undefined {
  const rows = db
    .select()
    .from(crops)
    .where(and(eq(crops.blockId, blockId), lte(crops.plantingDate, new Date(occurredAt))))
    .orderBy(desc(crops.plantingDate))
    .limit(1)
    .all();
  return rows[0] ? rowToCrop(rows[0]) : undefined;
}

/** Year list for the filter dropdown. */
export function listYearsWithCrops(): number[] {
  const all = db.select().from(crops).orderBy(asc(crops.plantingDate)).all();
  const years = new Set<number>();
  for (const r of all) years.add(new Date(r.plantingDate).getFullYear());
  return [...years].sort((a, b) => b - a);
}
