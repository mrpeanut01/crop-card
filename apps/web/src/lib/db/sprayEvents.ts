/**
 * Spray event repository (FR-09).
 *
 * Records are immutable after a configurable lock window (default 48 hours).
 * Server enforces; UI cannot bypass.
 *
 * The retention policy is "minimum 2 years" per spec §10. Phase 4 surfaces
 * a 2-year alert on near-expiry records but does not auto-delete; that
 * always requires explicit owner confirmation per NFR-05.
 *
 * Phase 18a: tenant-scoped. The lock window + retention semantics apply
 * within the active Owner; a Helper switching tenants does not see another
 * tenant's locked records.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { ChemistryClass, EnvironmentalConditions } from '$lib/safety/types';
import { db } from './client';
import { sprayEvents } from './schema';
import { currentOwnerId, tenantValues, tenantWhere, withTenant } from './tenant';
import { incrementUsageCounter } from '$lib/server/superadmin';

export const LOCK_WINDOW_MS = 48 * 60 * 60 * 1000;
export const RETENTION_WINDOW_MS = 2 * 365 * 24 * 60 * 60 * 1000;
export const RETENTION_ALERT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface SprayEventInput {
  blockId: string;
  cropId?: string;
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
    cropId: row.cropId ?? undefined,
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
    .values(
      tenantValues({
        id,
        blockId: input.blockId,
        cropId: input.cropId ?? null,
        sprayerId: input.sprayerId,
        performedById: input.performedById,
        occurredAt: new Date(input.occurredAt),
        productsJson: JSON.stringify(input.products),
        conditionsJson: JSON.stringify(input.conditions),
        rulesVersion: input.rulesVersion,
        pluginHashesJson: JSON.stringify(input.pluginHashes),
        customRateOverride: input.customRateOverride ?? false
      })
    )
    .returning()
    .get();
  // Phase 18g: usage counter for metered-billing readiness.
  const ownerId = currentOwnerId();
  if (ownerId) {
    try {
      incrementUsageCounter(ownerId, { sprayEventsCount: 1 });
    } catch (err) {
      console.error('[usage] failed to increment spray_events counter', err);
    }
  }
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

  let q = db
    .select()
    .from(sprayEvents)
    .where(withTenant(sprayEvents, conditions.length ? and(...conditions) : undefined))
    .$dynamic();
  q = q.orderBy(desc(sprayEvents.occurredAt));
  if (filters.limit) q = q.limit(filters.limit);

  return q.all().map(rowToEvent);
}

export function getSprayEvent(id: string): SprayEvent | undefined {
  const row = db
    .select()
    .from(sprayEvents)
    .where(withTenant(sprayEvents, eq(sprayEvents.id, id)))
    .get();
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
    .where(withTenant(sprayEvents, eq(sprayEvents.id, event.id)))
    .run();
  return lockedAt;
}

export function assertEditable(event: SprayEvent): void {
  const lockedAt = evaluateLock(event);
  if (lockedAt !== undefined) throw new RecordLockedError(lockedAt);
}

/**
 * Phase 21b follow-up — find the most recent spray_event for the block
 * that's still inside the 48h edit lock window. Used by /spray to
 * decide whether a multi-block record should PATCH an existing row or
 * POST a new one. Returns undefined when no editable event exists.
 *
 * Scope is tenant-scoped via `tenantWhere`; same-day cross-tenant
 * leakage is impossible by construction.
 */
export function findRecentEditableEventForBlock(
  blockId: string,
  now: number = Date.now()
): SprayEvent | undefined {
  const cutoff = now - LOCK_WINDOW_MS;
  const row = db
    .select()
    .from(sprayEvents)
    .where(
      withTenant(
        sprayEvents,
        and(eq(sprayEvents.blockId, blockId), gte(sprayEvents.occurredAt, new Date(cutoff)))
      )
    )
    .orderBy(desc(sprayEvents.occurredAt))
    .get();
  if (!row) return undefined;
  const event = rowToEvent(row);
  // Treat any pre-stamped lockedAt as authoritative (race-free per
  // evaluateLock semantics). A row inside the time window but with
  // lockedAt set has been frozen; refuse the edit path.
  if (event.lockedAt) return undefined;
  // Re-check the clock — covers the boundary where occurredAt is
  // inside the cutoff per the SQL filter but the lock window expires
  // between SELECT and the UPDATE that PATCH will attempt.
  if (now - event.occurredAt >= LOCK_WINDOW_MS) return undefined;
  return event;
}

/**
 * Phase 21b follow-up — replace the editable fields on a spray event.
 * Refuses if the row is locked (assertEditable throws RecordLockedError).
 * Does NOT touch blockId / sprayerId / performedById — those are
 * row-identity fields. Callers needing to change those should abort +
 * insert a new event.
 */
export function updateSprayEvent(
  id: string,
  input: {
    occurredAt?: number;
    products?: SprayEventInput['products'];
    conditions?: SprayEventInput['conditions'];
    pluginHashes?: Record<string, string>;
    customRateOverride?: boolean;
    cropId?: string | null;
  }
): SprayEvent {
  const existing = getSprayEvent(id);
  if (!existing) throw new Error(`unknown spray event: ${id}`);
  assertEditable(existing);
  const updates: Record<string, unknown> = {};
  if (input.occurredAt !== undefined) updates.occurredAt = new Date(input.occurredAt);
  if (input.products !== undefined) updates.productsJson = JSON.stringify(input.products);
  if (input.conditions !== undefined) updates.conditionsJson = JSON.stringify(input.conditions);
  if (input.pluginHashes !== undefined)
    updates.pluginHashesJson = JSON.stringify(input.pluginHashes);
  if (input.customRateOverride !== undefined) updates.customRateOverride = input.customRateOverride;
  if (input.cropId !== undefined) updates.cropId = input.cropId;
  const row = db
    .update(sprayEvents)
    .set(updates)
    .where(withTenant(sprayEvents, eq(sprayEvents.id, id)))
    .returning()
    .get();
  if (!row) throw new Error(`spray event row vanished during update: ${id}`);
  return rowToEvent(row);
}

export function recordsApproachingRetention(now: number = Date.now()): SprayEvent[] {
  // The alert should fire only in the 30-day pre-expiry window: records aged
  // between (retention - alert) and the full retention window. Without the
  // lower bound this also returned long-expired rows well past 2 years.
  const alertStart = now - RETENTION_WINDOW_MS;
  const alertEnd = now - (RETENTION_WINDOW_MS - RETENTION_ALERT_WINDOW_MS);
  // Use the listing function so tenant filter is applied uniformly. The
  // `tenantWhere` inside `listSprayEvents` is the canonical scope.
  void tenantWhere;
  return listSprayEvents({ fromMs: alertStart, toMs: alertEnd });
}
