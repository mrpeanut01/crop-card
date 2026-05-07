/**
 * Spray event repository (FR-09).
 *
 * Records are immutable after a configurable lock window (default 48 hours).
 * Server enforces; UI cannot bypass.
 *
 * The retention policy is "minimum 2 years" per spec §10. Phase 4 surfaces
 * a 2-year alert on near-expiry records but does not auto-delete; that
 * always requires explicit owner confirmation per NFR-05.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { ChemistryClass, EnvironmentalConditions } from '$lib/safety/types';
import { db } from './client';
import { sprayEvents } from './schema';

export const LOCK_WINDOW_MS = 48 * 60 * 60 * 1000;
export const RETENTION_WINDOW_MS = 2 * 365 * 24 * 60 * 60 * 1000;
export const RETENTION_ALERT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface SprayEventInput {
  blockId: string;
  sprayerId: string;
  performedById: string;
  occurredAt: number;
  products: Array<{
    pluginId: string;
    chemistryClasses: ChemistryClass[];
    rate?: { amount: number; unit: string };
  }>;
  conditions: EnvironmentalConditions & { cornHeightIn?: number };
  rulesVersion: string;
  pluginHashes: Record<string, string>;
  customRateOverride?: boolean;
  notes?: string;
}

export interface SprayEvent extends SprayEventInput {
  id: string;
  lockedAt?: number;
}

export class RecordLockedError extends Error {
  constructor(public readonly lockedAt: number) {
    super('spray record is locked (FR-09 48-hour immutability window)');
    this.name = 'RecordLockedError';
  }
}

function rowToEvent(row: typeof sprayEvents.$inferSelect): SprayEvent {
  return {
    id: row.id,
    blockId: row.blockId,
    sprayerId: row.sprayerId,
    performedById: row.performedById,
    occurredAt: row.occurredAt.getTime(),
    products: JSON.parse(row.productsJson),
    conditions: JSON.parse(row.conditionsJson),
    rulesVersion: row.rulesVersion,
    pluginHashes: JSON.parse(row.pluginHashesJson),
    customRateOverride: row.customRateOverride,
    lockedAt: row.lockedAt ? row.lockedAt.getTime() : undefined
  };
}

export function insertSprayEvent(input: SprayEventInput): SprayEvent {
  const id = randomUUID();
  const row = db
    .insert(sprayEvents)
    .values({
      id,
      blockId: input.blockId,
      sprayerId: input.sprayerId,
      performedById: input.performedById,
      occurredAt: new Date(input.occurredAt),
      productsJson: JSON.stringify(input.products),
      conditionsJson: JSON.stringify(input.conditions),
      rulesVersion: input.rulesVersion,
      pluginHashesJson: JSON.stringify(input.pluginHashes),
      customRateOverride: input.customRateOverride ?? false
    })
    .returning()
    .get();
  return rowToEvent(row);
}

export interface ListFilters {
  blockId?: string;
  sprayerId?: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
}

export function listSprayEvents(filters: ListFilters = {}): SprayEvent[] {
  const conditions = [];
  if (filters.blockId) conditions.push(eq(sprayEvents.blockId, filters.blockId));
  if (filters.sprayerId) conditions.push(eq(sprayEvents.sprayerId, filters.sprayerId));
  if (filters.fromMs !== undefined)
    conditions.push(gte(sprayEvents.occurredAt, new Date(filters.fromMs)));
  if (filters.toMs !== undefined)
    conditions.push(lte(sprayEvents.occurredAt, new Date(filters.toMs)));

  let q = db.select().from(sprayEvents).$dynamic();
  if (conditions.length > 0) q = q.where(and(...conditions));
  q = q.orderBy(desc(sprayEvents.occurredAt));
  if (filters.limit) q = q.limit(filters.limit);

  return q.all().map(rowToEvent);
}

export function getSprayEvent(id: string): SprayEvent | undefined {
  const row = db.select().from(sprayEvents).where(eq(sprayEvents.id, id)).get();
  return row ? rowToEvent(row) : undefined;
}

/**
 * The 48-hour lock kicks in on first read after the window passes — recording
 * the lockedAt timestamp once and refusing future edits. Returns the lock
 * timestamp if locked, undefined if still mutable.
 */
export function evaluateLock(event: SprayEvent, now: number = Date.now()): number | undefined {
  if (event.lockedAt) return event.lockedAt;
  const elapsed = now - event.occurredAt;
  if (elapsed < LOCK_WINDOW_MS) return undefined;
  // Race-free idempotent lock-stamp.
  const lockedAt = event.occurredAt + LOCK_WINDOW_MS;
  db.update(sprayEvents)
    .set({ lockedAt: new Date(lockedAt) })
    .where(eq(sprayEvents.id, event.id))
    .run();
  return lockedAt;
}

export function assertEditable(event: SprayEvent): void {
  const lockedAt = evaluateLock(event);
  if (lockedAt !== undefined) throw new RecordLockedError(lockedAt);
}

export function recordsApproachingRetention(now: number = Date.now()): SprayEvent[] {
  const cutoff = now - (RETENTION_WINDOW_MS - RETENTION_ALERT_WINDOW_MS);
  return listSprayEvents({ toMs: cutoff });
}
