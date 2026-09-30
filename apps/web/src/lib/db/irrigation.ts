/**
 * Watering logs and rain-gauge readings (Phase 32E, E4). Light records: no
 * lock, no tombstone, not in compliance exports, the year summary or
 * `RETENTION_RULES` (GW-7). Tenant-scoped through the helpers in `tenant.ts`.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm';
import { db } from './client';
import { irrigationEvents, rainGaugeReadings } from './schema';
import { tenantValues, withTenant } from './tenant';

export const IRRIGATION_METHODS = [
  'drip',
  'soaker',
  'sprinkler',
  'hand',
  'flood',
  'other'
] as const;
export type IrrigationMethod = (typeof IRRIGATION_METHODS)[number];

export interface IrrigationEvent {
  id: string;
  fieldId: string;
  blockId: string | null;
  occurredAt: number;
  durationMin: number | null;
  inches: number | null;
  gallons: number | null;
  method: IrrigationMethod | null;
  notes: string | null;
  performedById: string | null;
  createdAt: number;
}

export interface RainGaugeReading {
  id: string;
  fieldId: string;
  readAt: number;
  inches: number;
  recordedById: string | null;
  createdAt: number;
}

function toEvent(r: typeof irrigationEvents.$inferSelect): IrrigationEvent {
  return {
    id: r.id,
    fieldId: r.fieldId,
    blockId: r.blockId ?? null,
    occurredAt: r.occurredAt.getTime(),
    durationMin: r.durationMin ?? null,
    inches: r.inches ?? null,
    gallons: r.gallons ?? null,
    method: r.method ?? null,
    notes: r.notes ?? null,
    performedById: r.performedById ?? null,
    createdAt: r.createdAt.getTime()
  };
}

function toReading(r: typeof rainGaugeReadings.$inferSelect): RainGaugeReading {
  return {
    id: r.id,
    fieldId: r.fieldId,
    readAt: r.readAt.getTime(),
    inches: r.inches,
    recordedById: r.recordedById ?? null,
    createdAt: r.createdAt.getTime()
  };
}

export function insertIrrigationEvent(input: {
  fieldId: string;
  blockId?: string | null;
  occurredAt: number;
  durationMin?: number | null;
  inches?: number | null;
  gallons?: number | null;
  method?: IrrigationMethod | null;
  notes?: string | null;
  performedById?: string | null;
  clientRecordId?: string | null;
}): IrrigationEvent {
  const id = `irr_${randomUUID()}`;
  db.insert(irrigationEvents)
    .values(
      tenantValues({
        id,
        fieldId: input.fieldId,
        blockId: input.blockId ?? null,
        occurredAt: new Date(input.occurredAt),
        durationMin: input.durationMin ?? null,
        inches: input.inches ?? null,
        gallons: input.gallons ?? null,
        method: input.method ?? null,
        notes: input.notes ?? null,
        performedById: input.performedById ?? null,
        clientRecordId: input.clientRecordId ?? null
      })
    )
    .run();
  return getIrrigationEvent(id)!;
}

export function getIrrigationEvent(id: string): IrrigationEvent | undefined {
  const row = db
    .select()
    .from(irrigationEvents)
    .where(withTenant(irrigationEvents, eq(irrigationEvents.id, id)))
    .get();
  return row ? toEvent(row) : undefined;
}

export function listIrrigationEvents(
  opts: {
    fieldIds?: readonly string[];
    fromMs?: number;
    toMs?: number;
    limit?: number;
  } = {}
): IrrigationEvent[] {
  if (opts.fieldIds && opts.fieldIds.length === 0) return [];
  const conds = [
    opts.fieldIds ? inArray(irrigationEvents.fieldId, [...opts.fieldIds]) : undefined,
    opts.fromMs !== undefined ? gte(irrigationEvents.occurredAt, new Date(opts.fromMs)) : undefined,
    opts.toMs !== undefined ? lte(irrigationEvents.occurredAt, new Date(opts.toMs)) : undefined
  ].filter((c) => c !== undefined);
  const q = db
    .select()
    .from(irrigationEvents)
    .where(withTenant(irrigationEvents, conds.length ? and(...conds) : undefined))
    .orderBy(desc(irrigationEvents.occurredAt));
  return (opts.limit ? q.limit(opts.limit) : q).all().map(toEvent);
}

export function deleteIrrigationEvent(id: string): boolean {
  const res = db
    .delete(irrigationEvents)
    .where(withTenant(irrigationEvents, eq(irrigationEvents.id, id)))
    .run();
  return res.changes > 0;
}

export function insertRainGaugeReading(input: {
  fieldId: string;
  readAt: number;
  inches: number;
  recordedById?: string | null;
}): RainGaugeReading {
  const id = `rg_${randomUUID()}`;
  db.insert(rainGaugeReadings)
    .values(
      tenantValues({
        id,
        fieldId: input.fieldId,
        readAt: new Date(input.readAt),
        inches: input.inches,
        recordedById: input.recordedById ?? null
      })
    )
    .run();
  return getRainGaugeReading(id)!;
}

export function getRainGaugeReading(id: string): RainGaugeReading | undefined {
  const row = db
    .select()
    .from(rainGaugeReadings)
    .where(withTenant(rainGaugeReadings, eq(rainGaugeReadings.id, id)))
    .get();
  return row ? toReading(row) : undefined;
}

export function listRainGaugeReadings(
  opts: { fieldIds?: readonly string[]; fromMs?: number; toMs?: number; limit?: number } = {}
): RainGaugeReading[] {
  if (opts.fieldIds && opts.fieldIds.length === 0) return [];
  const conds = [
    opts.fieldIds ? inArray(rainGaugeReadings.fieldId, [...opts.fieldIds]) : undefined,
    opts.fromMs !== undefined ? gte(rainGaugeReadings.readAt, new Date(opts.fromMs)) : undefined,
    opts.toMs !== undefined ? lte(rainGaugeReadings.readAt, new Date(opts.toMs)) : undefined
  ].filter((c) => c !== undefined);
  const q = db
    .select()
    .from(rainGaugeReadings)
    .where(withTenant(rainGaugeReadings, conds.length ? and(...conds) : undefined))
    .orderBy(desc(rainGaugeReadings.readAt));
  return (opts.limit ? q.limit(opts.limit) : q).all().map(toReading);
}

/** The Area's latest reading taken before `beforeMs`, if any. */
export function previousGaugeReading(
  fieldId: string,
  beforeMs: number
): RainGaugeReading | undefined {
  const row = db
    .select()
    .from(rainGaugeReadings)
    .where(
      withTenant(
        rainGaugeReadings,
        and(
          eq(rainGaugeReadings.fieldId, fieldId),
          lt(rainGaugeReadings.readAt, new Date(beforeMs))
        )
      )
    )
    .orderBy(desc(rainGaugeReadings.readAt))
    .limit(1)
    .get();
  return row ? toReading(row) : undefined;
}

export function deleteRainGaugeReading(id: string): boolean {
  const res = db
    .delete(rainGaugeReadings)
    .where(withTenant(rainGaugeReadings, eq(rainGaugeReadings.id, id)))
    .run();
  return res.changes > 0;
}
