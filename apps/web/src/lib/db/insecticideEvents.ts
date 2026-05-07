/**
 * Insecticide event repository (Phase 10, FR-04 / UC-05).
 *
 * Mirror of sprayEvents.ts for the insecticide flow. Records are immutable
 * after the same 48-hour lock window so audit trails stay consistent across
 * herbicide / insecticide operations. Stores REI / PHI clear-by timestamps
 * computed from the plugin so the /today re-entry banner has a fast lookup.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { EnvironmentalConditions } from '$lib/safety/types';
import { db } from './client';
import { insecticideEvents } from './schema';

export const INSECTICIDE_LOCK_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface InsecticideProductSnapshot {
  pluginId: string;
  displayName: string;
  iracGroups: string[];
  rate?: { amount: number; unit: string };
}

export interface ScoutObservation {
  pest: string;
  metric: string;
  value: number;
  threshold?: number;
  notes?: string;
}

export interface InsecticideEventInput {
  blockId: string;
  sprayerId?: string;
  performedById: string;
  occurredAt: number;
  products: InsecticideProductSnapshot[];
  scoutObservation?: ScoutObservation;
  conditions: EnvironmentalConditions;
  reEntryClearAt?: number;
  preHarvestClearAt?: number;
  rulesVersion: string;
  pluginHashes: Record<string, string>;
}

export interface InsecticideEvent extends InsecticideEventInput {
  id: string;
  lockedAt?: number;
}

function rowToEvent(row: typeof insecticideEvents.$inferSelect): InsecticideEvent {
  return {
    id: row.id,
    blockId: row.blockId,
    sprayerId: row.sprayerId ?? undefined,
    performedById: row.performedById,
    occurredAt: row.occurredAt.getTime(),
    products: JSON.parse(row.productsJson),
    scoutObservation: row.scoutObservationJson ? JSON.parse(row.scoutObservationJson) : undefined,
    conditions: JSON.parse(row.conditionsJson),
    reEntryClearAt: row.reEntryClearAt?.getTime(),
    preHarvestClearAt: row.preHarvestClearAt?.getTime(),
    rulesVersion: row.rulesVersion,
    pluginHashes: JSON.parse(row.pluginHashesJson),
    lockedAt: row.lockedAt?.getTime()
  };
}

export function insertInsecticideEvent(input: InsecticideEventInput): InsecticideEvent {
  const id = randomUUID();
  const row = db
    .insert(insecticideEvents)
    .values({
      id,
      blockId: input.blockId,
      sprayerId: input.sprayerId ?? null,
      performedById: input.performedById,
      occurredAt: new Date(input.occurredAt),
      productsJson: JSON.stringify(input.products),
      scoutObservationJson: input.scoutObservation ? JSON.stringify(input.scoutObservation) : null,
      conditionsJson: JSON.stringify(input.conditions),
      reEntryClearAt: input.reEntryClearAt ? new Date(input.reEntryClearAt) : null,
      preHarvestClearAt: input.preHarvestClearAt ? new Date(input.preHarvestClearAt) : null,
      rulesVersion: input.rulesVersion,
      pluginHashesJson: JSON.stringify(input.pluginHashes)
    })
    .returning()
    .get();
  return rowToEvent(row);
}

export interface ListFilters {
  blockId?: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
}

export function listInsecticideEvents(filters: ListFilters = {}): InsecticideEvent[] {
  const conditions = [];
  if (filters.blockId) conditions.push(eq(insecticideEvents.blockId, filters.blockId));
  if (filters.fromMs !== undefined)
    conditions.push(gte(insecticideEvents.occurredAt, new Date(filters.fromMs)));
  if (filters.toMs !== undefined)
    conditions.push(lte(insecticideEvents.occurredAt, new Date(filters.toMs)));

  let q = db.select().from(insecticideEvents).$dynamic();
  if (conditions.length > 0) q = q.where(and(...conditions));
  q = q.orderBy(desc(insecticideEvents.occurredAt));
  if (filters.limit) q = q.limit(filters.limit);

  return q.all().map(rowToEvent);
}

/** Blocks currently inside a re-entry interval — drives the /today banner. */
export function activeReEntryRestrictions(now: number = Date.now()): InsecticideEvent[] {
  const all = db
    .select()
    .from(insecticideEvents)
    .where(gte(insecticideEvents.reEntryClearAt, new Date(now)))
    .all();
  return all.map(rowToEvent);
}
