/**
 * Automatic waterers (Phase 37E, R-21): the Areas and beds each one waters
 * and the scheduled runs people said did not water. Tenant-scoped through
 * the helpers in `tenant.ts`. A target row with no `block_id` covers the
 * whole Area; the unique index treats each null block as distinct, so the
 * repo dedupes before inserting.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { db } from './client';
import {
  blocks,
  equipmentWaterTargets,
  fields,
  irrigationSkips,
  IRRIGATION_SKIP_REASONS
} from './schema';
import { tenantValues, withTenant } from './tenant';

export type IrrigationSkipReason = (typeof IRRIGATION_SKIP_REASONS)[number];

export interface WaterTargetRow {
  equipmentId: string;
  fieldId: string;
  blockId: string | null;
  /** The owner's whole-percent share of the gallons (FU870-1); null splits by size. */
  sharePct: number | null;
}

export type TargetInput = Omit<WaterTargetRow, 'equipmentId' | 'sharePct'> & {
  sharePct?: number | null;
};

export interface IrrigationSkip {
  id: string;
  equipmentId: string;
  scheduledAt: number;
  reason: IrrigationSkipReason;
  notes: string | null;
  createdBy: string | null;
  createdAt: number;
}

function toSkip(r: typeof irrigationSkips.$inferSelect): IrrigationSkip {
  return {
    id: r.id,
    equipmentId: r.equipmentId,
    scheduledAt: r.scheduledAt.getTime(),
    reason: r.reason,
    notes: r.notes ?? null,
    createdBy: r.createdBy ?? null,
    createdAt: r.createdAt.getTime()
  };
}

/** Whole-Area rows first, then beds; a bed inside an Area that is covered
 *  whole is dropped, and repeats are dropped. */
export function normalizeTargets(rows: readonly TargetInput[]): TargetInput[] {
  const whole = new Set(rows.filter((r) => r.blockId === null).map((r) => r.fieldId));
  const seen = new Set<string>();
  const out: TargetInput[] = [];
  for (const r of [...rows].sort(
    (a, b) => Number(a.blockId !== null) - Number(b.blockId !== null)
  )) {
    if (r.blockId !== null && whole.has(r.fieldId)) continue;
    const key = `${r.fieldId}|${r.blockId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      fieldId: r.fieldId,
      blockId: r.blockId,
      ...(r.sharePct !== undefined ? { sharePct: r.sharePct } : {})
    });
  }
  return out;
}

export function listWaterTargets(equipmentIds?: readonly string[]): WaterTargetRow[] {
  if (equipmentIds && equipmentIds.length === 0) return [];
  return db
    .select({
      equipmentId: equipmentWaterTargets.equipmentId,
      fieldId: equipmentWaterTargets.fieldId,
      blockId: equipmentWaterTargets.blockId,
      sharePct: equipmentWaterTargets.sharePct
    })
    .from(equipmentWaterTargets)
    .where(
      withTenant(
        equipmentWaterTargets,
        equipmentIds ? inArray(equipmentWaterTargets.equipmentId, [...equipmentIds]) : undefined
      )
    )
    .orderBy(asc(equipmentWaterTargets.fieldId), asc(equipmentWaterTargets.blockId))
    .all()
    .map((r) => ({ ...r, blockId: r.blockId ?? null, sharePct: r.sharePct ?? null }));
}

/** Replaces every target of one waterer in one transaction. A typed share
 *  is kept only when the timer has more than one target. */
export function replaceWaterTargets(
  equipmentId: string,
  rows: readonly TargetInput[]
): WaterTargetRow[] {
  const clean = normalizeTargets(rows);
  db.transaction(() => {
    db.delete(equipmentWaterTargets)
      .where(withTenant(equipmentWaterTargets, eq(equipmentWaterTargets.equipmentId, equipmentId)))
      .run();
    for (const r of clean) {
      db.insert(equipmentWaterTargets)
        .values(
          tenantValues({
            id: randomUUID(),
            equipmentId,
            fieldId: r.fieldId,
            blockId: r.blockId,
            sharePct: clean.length > 1 ? (r.sharePct ?? null) : null
          })
        )
        .run();
    }
  });
  return listWaterTargets([equipmentId]);
}

/** The size columns of an Area or bed, as the water balance reads them. */
export interface SizeColumns {
  acres: number | null;
  widthFt: number | null;
  lengthFt: number | null;
  geometryGeojson: string | null;
}

/** A target with what the gallons split needs (FU870-1). */
export interface WaterTargetDetail extends WaterTargetRow {
  fieldSize: SizeColumns;
  /** The bed's size; null for a whole-Area target. */
  blockSize: SizeColumns | null;
  /** The Area the bed lies in now; null for a whole-Area target. */
  blockFieldId: string | null;
}

/** A logged skip as a card shows it, with who logged it and when. */
export interface SkipSummary {
  id: string;
  equipmentId: string;
  scheduledAt: number;
  reason: IrrigationSkipReason;
  createdBy: string | null;
  createdAt: number;
}

export interface WatererRowsForAreas {
  /** Every target of each waterer that waters one of the Areas, the other
   *  Areas' too, so the gallons split sees the whole timer. */
  targets: WaterTargetDetail[];
  /** Skipped run starts by equipment id, inside the window. */
  skips: Map<string, number[]>;
  /** The same skips with their ids, oldest run first (FU870-2). */
  skipRows: Map<string, SkipSummary[]>;
}

const TARGET_DETAIL_COLUMNS = {
  equipmentId: equipmentWaterTargets.equipmentId,
  fieldId: equipmentWaterTargets.fieldId,
  blockId: equipmentWaterTargets.blockId,
  sharePct: equipmentWaterTargets.sharePct,
  fAcres: fields.acres,
  fWidth: fields.widthFt,
  fLength: fields.lengthFt,
  fGeo: fields.geometryGeojson,
  bFieldId: blocks.fieldId,
  bAcres: blocks.acres,
  bWidth: blocks.widthFt,
  bLength: blocks.lengthFt,
  bGeo: blocks.geometryGeojson
};

const TARGET_FIELD_JOIN = and(
  eq(fields.id, equipmentWaterTargets.fieldId),
  eq(fields.ownerId, equipmentWaterTargets.ownerId)
);
const TARGET_BLOCK_JOIN = and(
  eq(blocks.id, equipmentWaterTargets.blockId),
  eq(blocks.ownerId, equipmentWaterTargets.ownerId)
);

interface TargetDetailColumns {
  equipmentId: string;
  fieldId: string;
  blockId: string | null;
  sharePct: number | null;
  fAcres: number | null;
  fWidth: number | null;
  fLength: number | null;
  fGeo: string | null;
  bFieldId: string | null;
  bAcres: number | null;
  bWidth: number | null;
  bLength: number | null;
  bGeo: string | null;
}

function targetDetailOf(r: TargetDetailColumns): WaterTargetDetail {
  const blockId = r.blockId ?? null;
  return {
    equipmentId: r.equipmentId,
    fieldId: r.fieldId,
    blockId,
    sharePct: r.sharePct ?? null,
    fieldSize: {
      acres: r.fAcres ?? null,
      widthFt: r.fWidth ?? null,
      lengthFt: r.fLength ?? null,
      geometryGeojson: r.fGeo ?? null
    },
    blockSize:
      blockId === null
        ? null
        : {
            acres: r.bAcres ?? null,
            widthFt: r.bWidth ?? null,
            lengthFt: r.bLength ?? null,
            geometryGeojson: r.bGeo ?? null
          },
    blockFieldId: blockId === null ? null : (r.bFieldId ?? null)
  };
}

/** One waterer's targets with their sizes, for the equipment page's split. */
export function listWaterTargetDetails(equipmentId: string): WaterTargetDetail[] {
  return db
    .select(TARGET_DETAIL_COLUMNS)
    .from(equipmentWaterTargets)
    .innerJoin(fields, TARGET_FIELD_JOIN)
    .leftJoin(blocks, TARGET_BLOCK_JOIN)
    .where(withTenant(equipmentWaterTargets, eq(equipmentWaterTargets.equipmentId, equipmentId)))
    .orderBy(asc(equipmentWaterTargets.fieldId), asc(equipmentWaterTargets.blockId))
    .all()
    .map(targetDetailOf);
}

/** /today's one waterer read (R-22): every target of the waterers on the
 *  given Areas, with each target's size, joined to the skips inside
 *  [fromMs, toMs). One statement. */
export function loadWatererRowsForAreas(
  fieldIds: readonly string[],
  fromMs: number,
  toMs: number
): WatererRowsForAreas {
  if (fieldIds.length === 0) return { targets: [], skips: new Map(), skipRows: new Map() };
  const timersHere = db
    .select({ equipmentId: equipmentWaterTargets.equipmentId })
    .from(equipmentWaterTargets)
    .where(
      withTenant(equipmentWaterTargets, inArray(equipmentWaterTargets.fieldId, [...fieldIds]))
    );
  const rows = db
    .select({
      ...TARGET_DETAIL_COLUMNS,
      skipId: irrigationSkips.id,
      skippedAt: irrigationSkips.scheduledAt,
      skipReason: irrigationSkips.reason,
      skipBy: irrigationSkips.createdBy,
      skipLoggedAt: irrigationSkips.createdAt
    })
    .from(equipmentWaterTargets)
    .innerJoin(fields, TARGET_FIELD_JOIN)
    .leftJoin(blocks, TARGET_BLOCK_JOIN)
    .leftJoin(
      irrigationSkips,
      and(
        eq(irrigationSkips.equipmentId, equipmentWaterTargets.equipmentId),
        eq(irrigationSkips.ownerId, equipmentWaterTargets.ownerId),
        gte(irrigationSkips.scheduledAt, new Date(fromMs)),
        lt(irrigationSkips.scheduledAt, new Date(toMs))
      )
    )
    .where(
      withTenant(equipmentWaterTargets, inArray(equipmentWaterTargets.equipmentId, timersHere))
    )
    .orderBy(
      asc(equipmentWaterTargets.equipmentId),
      asc(equipmentWaterTargets.fieldId),
      asc(equipmentWaterTargets.blockId)
    )
    .all();
  const targets = new Map<string, WaterTargetDetail>();
  const skips = new Map<string, Map<string, SkipSummary>>();
  for (const r of rows) {
    const key = `${r.equipmentId}|${r.fieldId}|${r.blockId ?? ''}`;
    if (!targets.has(key)) targets.set(key, targetDetailOf(r));
    if (r.skipId && r.skippedAt && r.skipReason) {
      const byId = skips.get(r.equipmentId) ?? new Map<string, SkipSummary>();
      byId.set(r.skipId, {
        id: r.skipId,
        equipmentId: r.equipmentId,
        scheduledAt: r.skippedAt.getTime(),
        reason: r.skipReason,
        createdBy: r.skipBy ?? null,
        createdAt: r.skipLoggedAt ? r.skipLoggedAt.getTime() : 0
      });
      skips.set(r.equipmentId, byId);
    }
  }
  const skipRows = new Map(
    [...skips].map(([k, v]) => [
      k,
      [...v.values()].sort((a, b) => a.scheduledAt - b.scheduledAt || a.id.localeCompare(b.id))
    ])
  );
  return {
    targets: [...targets.values()],
    skips: new Map([...skipRows].map(([k, v]) => [k, [...new Set(v.map((x) => x.scheduledAt))]])),
    skipRows
  };
}

export function getIrrigationSkip(id: string): IrrigationSkip | null {
  const row = db
    .select()
    .from(irrigationSkips)
    .where(withTenant(irrigationSkips, eq(irrigationSkips.id, id)))
    .get();
  return row ? toSkip(row) : null;
}

/** Undo a skip (FU870-2): the run counts as water given again. A hard
 *  delete, like task time: a skip is neither a compliance record nor a
 *  hold fact. */
export function deleteIrrigationSkip(id: string): boolean {
  const res = db
    .delete(irrigationSkips)
    .where(withTenant(irrigationSkips, eq(irrigationSkips.id, id)))
    .run();
  return res.changes > 0;
}

export function findIrrigationSkip(
  equipmentId: string,
  scheduledAt: number
): IrrigationSkip | null {
  const row = db
    .select()
    .from(irrigationSkips)
    .where(
      withTenant(
        irrigationSkips,
        eq(irrigationSkips.equipmentId, equipmentId),
        eq(irrigationSkips.scheduledAt, new Date(scheduledAt))
      )
    )
    .get();
  return row ? toSkip(row) : null;
}

export function insertIrrigationSkip(input: {
  equipmentId: string;
  scheduledAt: number;
  reason: IrrigationSkipReason;
  notes?: string | null;
  createdBy?: string | null;
  clientRecordId?: string | null;
}): IrrigationSkip {
  const row = db
    .insert(irrigationSkips)
    .values(
      tenantValues({
        id: randomUUID(),
        equipmentId: input.equipmentId,
        scheduledAt: new Date(input.scheduledAt),
        reason: input.reason,
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
        clientRecordId: input.clientRecordId ?? null
      })
    )
    .returning()
    .get();
  return toSkip(row);
}

export function listIrrigationSkips(opts: {
  equipmentIds?: readonly string[];
  fromMs?: number;
  toMs?: number;
  limit?: number;
}): IrrigationSkip[] {
  if (opts.equipmentIds && opts.equipmentIds.length === 0) return [];
  return db
    .select()
    .from(irrigationSkips)
    .where(
      withTenant(
        irrigationSkips,
        opts.equipmentIds
          ? inArray(irrigationSkips.equipmentId, [...opts.equipmentIds])
          : undefined,
        opts.fromMs !== undefined
          ? gte(irrigationSkips.scheduledAt, new Date(opts.fromMs))
          : undefined,
        opts.toMs !== undefined ? lt(irrigationSkips.scheduledAt, new Date(opts.toMs)) : undefined
      )
    )
    .orderBy(asc(irrigationSkips.scheduledAt))
    .limit(Math.min(Math.max(opts.limit ?? 200, 1), 500))
    .all()
    .map(toSkip);
}
