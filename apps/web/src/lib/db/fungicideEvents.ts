/**
 * Fungicide event repository (Phase 21 / B-18 / UC-37d).
 *
 * Mirror of `insecticideEvents.ts` for the fungicide flow. Records are
 * immutable after the same 48-hour lock window so audit trails stay
 * consistent across herbicide / insecticide / fungicide operations.
 * Stores REI / PHI clear-by timestamps computed from the plugin so the
 * /today re-entry banner has a fast lookup.
 *
 * Field-for-field parallel to `insecticideEvents` — the only structural
 * difference is the product-snapshot carries FRAC codes (Fungicide
 * Resistance Action Committee) instead of IRAC groups. PHI windows are
 * typically much longer for fungicides (14–21d vs 0–7d for
 * insecticides) but the storage shape is identical.
 *
 * Phase 18a: tenant-scoped.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { EnvironmentalConditions } from '$lib/safety/types';
import { db } from './client';
import { fungicideEvents } from './schema';
import { tenantValues, withTenant } from './tenant';

export const FUNGICIDE_LOCK_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface FungicideProductSnapshot {
  pluginId: string;
  displayName: string;
  fracCodes: string[];
  rate?: { amount: number; unit: string };
}

/** Symmetric to `ScoutObservation` on the insecticide flow but typed
 *  as "disease density / lesion count" semantics — same DB shape, just
 *  carrying disease names rather than pest names. */
export interface DiseaseObservation {
  disease: string;
  metric: string;
  value: number;
  threshold?: number;
  notes?: string;
}

export interface FungicideEventInput {
  blockId: string;
  cropId?: string;
  sprayerId?: string;
  performedById: string;
  occurredAt: number;
  products: FungicideProductSnapshot[];
  diseaseObservation?: DiseaseObservation;
  conditions: EnvironmentalConditions;
  reEntryClearAt?: number;
  preHarvestClearAt?: number;
  rulesVersion: string;
  pluginHashes: Record<string, string>;
}

export interface FungicideEvent extends FungicideEventInput {
  id: string;
  lockedAt?: number;
}

function rowToEvent(row: typeof fungicideEvents.$inferSelect): FungicideEvent {
  return {
    id: row.id,
    blockId: row.blockId,
    cropId: row.cropId ?? undefined,
    sprayerId: row.sprayerId ?? undefined,
    performedById: row.performedById,
    occurredAt: row.occurredAt.getTime(),
    products: JSON.parse(row.productsJson),
    diseaseObservation: row.scoutObservationJson
      ? JSON.parse(row.scoutObservationJson)
      : undefined,
    conditions: JSON.parse(row.conditionsJson),
    reEntryClearAt: row.reEntryClearAt?.getTime(),
    preHarvestClearAt: row.preHarvestClearAt?.getTime(),
    rulesVersion: row.rulesVersion,
    pluginHashes: JSON.parse(row.pluginHashesJson),
    lockedAt: row.lockedAt?.getTime()
  };
}

export function insertFungicideEvent(input: FungicideEventInput): FungicideEvent {
  const id = randomUUID();
  const row = db
    .insert(fungicideEvents)
    .values(
      tenantValues({
        id,
        blockId: input.blockId,
        cropId: input.cropId ?? null,
        sprayerId: input.sprayerId ?? null,
        performedById: input.performedById,
        occurredAt: new Date(input.occurredAt),
        productsJson: JSON.stringify(input.products),
        scoutObservationJson: input.diseaseObservation
          ? JSON.stringify(input.diseaseObservation)
          : null,
        conditionsJson: JSON.stringify(input.conditions),
        reEntryClearAt: input.reEntryClearAt ? new Date(input.reEntryClearAt) : null,
        preHarvestClearAt: input.preHarvestClearAt ? new Date(input.preHarvestClearAt) : null,
        rulesVersion: input.rulesVersion,
        pluginHashesJson: JSON.stringify(input.pluginHashes)
      })
    )
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

export function listFungicideEvents(filters: ListFilters = {}): FungicideEvent[] {
  const conditions = [];
  if (filters.blockId) conditions.push(eq(fungicideEvents.blockId, filters.blockId));
  if (filters.fromMs !== undefined)
    conditions.push(gte(fungicideEvents.occurredAt, new Date(filters.fromMs)));
  if (filters.toMs !== undefined)
    conditions.push(lte(fungicideEvents.occurredAt, new Date(filters.toMs)));

  let q = db
    .select()
    .from(fungicideEvents)
    .where(withTenant(fungicideEvents, conditions.length ? and(...conditions) : undefined))
    .$dynamic();
  q = q.orderBy(desc(fungicideEvents.occurredAt));
  if (filters.limit) q = q.limit(filters.limit);

  return q.all().map(rowToEvent);
}

/** Blocks currently inside a fungicide re-entry interval — feeds the
 *  /today re-entry banner alongside `activeReEntryRestrictions` from
 *  the insecticide repo. */
export function activeFungicideReEntryRestrictions(now: number = Date.now()): FungicideEvent[] {
  const all = db
    .select()
    .from(fungicideEvents)
    .where(withTenant(fungicideEvents, gte(fungicideEvents.reEntryClearAt, new Date(now))))
    .all();
  return all.map(rowToEvent);
}
