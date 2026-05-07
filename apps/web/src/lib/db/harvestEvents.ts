/**
 * Harvest event repo (UC-06, FR-08).
 *
 * Records: variety, block, harvest date, quantity, lot number. Surfaces a
 * curing-status field so post-harvest tracking can update without re-entering
 * the row. Same retention + immutability semantics as spray records.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from './client';
import { harvestEvents } from './schema';

export interface HarvestEventInput {
  blockId: string;
  cropPluginId: string;
  occurredAt: number;
  quantity?: string;
  lotNumber?: string;
}

export interface HarvestEvent extends HarvestEventInput {
  id: string;
}

export function insertHarvestEvent(input: HarvestEventInput): HarvestEvent {
  const id = randomUUID();
  const row = db
    .insert(harvestEvents)
    .values({
      id,
      blockId: input.blockId,
      cropPluginId: input.cropPluginId,
      occurredAt: new Date(input.occurredAt),
      quantity: input.quantity ?? null,
      lotNumber: input.lotNumber ?? null
    })
    .returning()
    .get();
  return rowToEvent(row);
}

export interface ListFilters {
  blockId?: string;
  cropPluginId?: string;
  fromMs?: number;
  toMs?: number;
}

export function listHarvestEvents(filters: ListFilters = {}): HarvestEvent[] {
  const conditions = [];
  if (filters.blockId) conditions.push(eq(harvestEvents.blockId, filters.blockId));
  if (filters.cropPluginId) conditions.push(eq(harvestEvents.cropPluginId, filters.cropPluginId));
  if (filters.fromMs !== undefined) conditions.push(gte(harvestEvents.occurredAt, new Date(filters.fromMs)));
  if (filters.toMs !== undefined) conditions.push(lte(harvestEvents.occurredAt, new Date(filters.toMs)));

  let q = db.select().from(harvestEvents).$dynamic();
  if (conditions.length > 0) q = q.where(and(...conditions));
  q = q.orderBy(desc(harvestEvents.occurredAt));
  return q.all().map(rowToEvent);
}

function rowToEvent(row: typeof harvestEvents.$inferSelect): HarvestEvent {
  return {
    id: row.id,
    blockId: row.blockId,
    cropPluginId: row.cropPluginId,
    occurredAt: row.occurredAt.getTime(),
    quantity: row.quantity ?? undefined,
    lotNumber: row.lotNumber ?? undefined
  };
}
