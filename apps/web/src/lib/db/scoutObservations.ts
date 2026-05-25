/**
 * Phase 25d (#95) — scout observations repo. Tenant-scoped per
 * CLAUDE.md invariant 6; every read/write funnels through tenant
 * helpers (`tenantWhere`, `tenantValues`).
 *
 * Primary read path for the IPM threshold gate evaluator. Backwards-
 * compatible with the pre-table data path: callers union these rows
 * with the legacy `insecticide_events.scoutObservationJson` payloads
 * (which the IPM evaluator integration in `/api/insecticide/record`
 * already reads). New scout observations should write here.
 */

import { randomUUID } from 'node:crypto';
import { desc, eq, gte } from 'drizzle-orm';
import { db } from './client';
import { scoutObservations } from './schema';
import { tenantValues, withTenant } from './tenant';

export interface ScoutObservationInput {
  blockId: string;
  cropId?: string;
  performedById: string;
  pest: string;
  metric: string;
  value: number;
  notes?: string;
  occurredAt: number;
}

export interface ScoutObservation extends ScoutObservationInput {
  id: string;
  ownerId: string;
  createdAt: number;
}

function rowToObservation(row: typeof scoutObservations.$inferSelect): ScoutObservation {
  return {
    id: row.id,
    ownerId: row.ownerId,
    blockId: row.blockId,
    cropId: row.cropId ?? undefined,
    performedById: row.performedById,
    pest: row.pest,
    metric: row.metric,
    value: row.value,
    notes: row.notes ?? undefined,
    occurredAt: row.occurredAt.getTime(),
    createdAt: row.createdAt.getTime()
  };
}

export function insertScoutObservation(input: ScoutObservationInput): ScoutObservation {
  const row = db
    .insert(scoutObservations)
    .values(
      tenantValues({
        id: randomUUID(),
        blockId: input.blockId,
        cropId: input.cropId ?? null,
        performedById: input.performedById,
        pest: input.pest,
        metric: input.metric,
        value: input.value,
        notes: input.notes ?? null,
        occurredAt: new Date(input.occurredAt)
      })
    )
    .returning()
    .get();
  return rowToObservation(row);
}

export interface ListFilters {
  blockId?: string;
  pest?: string;
  metric?: string;
  fromMs?: number;
  limit?: number;
}

export function listScoutObservations(filters: ListFilters = {}): ScoutObservation[] {
  const conds = [
    filters.blockId ? eq(scoutObservations.blockId, filters.blockId) : undefined,
    filters.pest ? eq(scoutObservations.pest, filters.pest) : undefined,
    filters.metric ? eq(scoutObservations.metric, filters.metric) : undefined,
    filters.fromMs !== undefined
      ? gte(scoutObservations.occurredAt, new Date(filters.fromMs))
      : undefined
  ];

  let q = db
    .select()
    .from(scoutObservations)
    .where(withTenant(scoutObservations, ...conds))
    .$dynamic();
  q = q.orderBy(desc(scoutObservations.occurredAt));
  if (filters.limit) q = q.limit(filters.limit);

  return q.all().map(rowToObservation);
}

/**
 * Recent scout observations grouped by block — convenience read for the
 * /spray/insecticide loader's IPM gate dial + 5-week sparkline. Drops
 * the legacy "read from past insecticide events" path in favor of this
 * dedicated table (see #95).
 */
export function scoutLogByBlock(
  windowMs: number = 35 * 86_400_000
): Record<string, Array<{ pest: string; metric: string; value: number; occurredAt: number }>> {
  const since = Date.now() - windowMs;
  const all = listScoutObservations({ fromMs: since, limit: 200 });
  const out: Record<
    string,
    Array<{ pest: string; metric: string; value: number; occurredAt: number }>
  > = {};
  for (const o of all) {
    const list = (out[o.blockId] ??= []);
    list.push({
      pest: o.pest,
      metric: o.metric,
      value: o.value,
      occurredAt: o.occurredAt
    });
  }
  return out;
}
