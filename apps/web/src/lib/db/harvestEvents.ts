/**
 * Harvest event repo (UC-06, FR-08).
 *
 * Records: variety, block, harvest date, quantity, lot number. Surfaces a
 * curing-status field so post-harvest tracking can update without re-entering
 * the row. Same retention + immutability semantics as spray records.
 *
 * Phase 18a: tenant-scoped.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from './client';
import { harvestEvents } from './schema';
import { tenantValues, withTenant } from './tenant';

export const HARVEST_LOCK_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface HarvestEventInput {
  blockId: string;
  cropId?: string;
  cropPluginId: string;
  occurredAt: number;
  quantity?: string;
  lotNumber?: string;
}

export interface HarvestEvent extends HarvestEventInput {
  id: string;
  lockedAt?: number;
}

export class RecordLockedError extends Error {
  constructor(public readonly lockedAt: number) {
    super('harvest record is locked (FR-09 48-hour immutability window)');
    this.name = 'RecordLockedError';
  }
}

export function insertHarvestEvent(input: HarvestEventInput): HarvestEvent {
  const id = randomUUID();
  const row = db
    .insert(harvestEvents)
    .values(
      tenantValues({
        id,
        blockId: input.blockId,
        cropId: input.cropId ?? null,
        cropPluginId: input.cropPluginId,
        occurredAt: new Date(input.occurredAt),
        quantity: input.quantity ?? null,
        lotNumber: input.lotNumber ?? null
      })
    )
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
  if (filters.fromMs !== undefined)
    conditions.push(gte(harvestEvents.occurredAt, new Date(filters.fromMs)));
  if (filters.toMs !== undefined)
    conditions.push(lte(harvestEvents.occurredAt, new Date(filters.toMs)));

  let q = db
    .select()
    .from(harvestEvents)
    .where(withTenant(harvestEvents, conditions.length ? and(...conditions) : undefined))
    .$dynamic();
  q = q.orderBy(desc(harvestEvents.occurredAt));
  return q.all().map(rowToEvent);
}

function rowToEvent(row: typeof harvestEvents.$inferSelect): HarvestEvent {
  return {
    id: row.id,
    blockId: row.blockId,
    cropId: row.cropId ?? undefined,
    cropPluginId: row.cropPluginId,
    occurredAt: row.occurredAt.getTime(),
    quantity: row.quantity ?? undefined,
    lotNumber: row.lotNumber ?? undefined,
    lockedAt: row.lockedAt?.getTime()
  };
}

export function getHarvestEvent(id: string): HarvestEvent | undefined {
  const row = db
    .select()
    .from(harvestEvents)
    .where(withTenant(harvestEvents, eq(harvestEvents.id, id)))
    .get();
  return row ? rowToEvent(row) : undefined;
}

/**
 * FR-09 (#308) — the 48-hour lock kicks in on first read after the window
 * passes, stamping `lockedAt` once and refusing future edits/deletes.
 * Returns the lock timestamp if locked, undefined if still mutable.
 * Mirrors sprayEvents.evaluateLock exactly.
 */
export function evaluateLock(event: HarvestEvent, now: number = Date.now()): number | undefined {
  if (event.lockedAt) return event.lockedAt;
  const elapsed = now - event.occurredAt;
  if (elapsed < HARVEST_LOCK_WINDOW_MS) return undefined;
  const lockedAt = event.occurredAt + HARVEST_LOCK_WINDOW_MS;
  db.update(harvestEvents)
    .set({ lockedAt: new Date(lockedAt) })
    .where(withTenant(harvestEvents, eq(harvestEvents.id, event.id)))
    .run();
  return lockedAt;
}

export function assertEditable(event: HarvestEvent): void {
  const lockedAt = evaluateLock(event);
  if (lockedAt !== undefined) throw new RecordLockedError(lockedAt);
}
