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
import { equipmentWaterTargets, irrigationSkips, IRRIGATION_SKIP_REASONS } from './schema';
import { tenantValues, withTenant } from './tenant';

export type IrrigationSkipReason = (typeof IRRIGATION_SKIP_REASONS)[number];

export interface WaterTargetRow {
  equipmentId: string;
  fieldId: string;
  blockId: string | null;
}

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
export function normalizeTargets(rows: readonly Omit<WaterTargetRow, 'equipmentId'>[]) {
  const whole = new Set(rows.filter((r) => r.blockId === null).map((r) => r.fieldId));
  const seen = new Set<string>();
  const out: Array<Omit<WaterTargetRow, 'equipmentId'>> = [];
  for (const r of [...rows].sort(
    (a, b) => Number(a.blockId !== null) - Number(b.blockId !== null)
  )) {
    if (r.blockId !== null && whole.has(r.fieldId)) continue;
    const key = `${r.fieldId}|${r.blockId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ fieldId: r.fieldId, blockId: r.blockId });
  }
  return out;
}

export function listWaterTargets(equipmentIds?: readonly string[]): WaterTargetRow[] {
  if (equipmentIds && equipmentIds.length === 0) return [];
  return db
    .select({
      equipmentId: equipmentWaterTargets.equipmentId,
      fieldId: equipmentWaterTargets.fieldId,
      blockId: equipmentWaterTargets.blockId
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
    .map((r) => ({ ...r, blockId: r.blockId ?? null }));
}

/** Replaces every target of one waterer in one transaction. */
export function replaceWaterTargets(
  equipmentId: string,
  rows: readonly Omit<WaterTargetRow, 'equipmentId'>[]
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
            blockId: r.blockId
          })
        )
        .run();
    }
  });
  return listWaterTargets([equipmentId]);
}

export interface WatererRowsForAreas {
  targets: WaterTargetRow[];
  /** Skipped run starts by equipment id, inside the window. */
  skips: Map<string, number[]>;
}

/** /today's one waterer read (R-22): the targets on the given Areas joined
 *  to the skips inside [fromMs, toMs). */
export function loadWatererRowsForAreas(
  fieldIds: readonly string[],
  fromMs: number,
  toMs: number
): WatererRowsForAreas {
  if (fieldIds.length === 0) return { targets: [], skips: new Map() };
  const rows = db
    .select({
      equipmentId: equipmentWaterTargets.equipmentId,
      fieldId: equipmentWaterTargets.fieldId,
      blockId: equipmentWaterTargets.blockId,
      skippedAt: irrigationSkips.scheduledAt
    })
    .from(equipmentWaterTargets)
    .leftJoin(
      irrigationSkips,
      and(
        eq(irrigationSkips.equipmentId, equipmentWaterTargets.equipmentId),
        eq(irrigationSkips.ownerId, equipmentWaterTargets.ownerId),
        gte(irrigationSkips.scheduledAt, new Date(fromMs)),
        lt(irrigationSkips.scheduledAt, new Date(toMs))
      )
    )
    .where(withTenant(equipmentWaterTargets, inArray(equipmentWaterTargets.fieldId, [...fieldIds])))
    .all();
  const targets = new Map<string, WaterTargetRow>();
  const skips = new Map<string, Set<number>>();
  for (const r of rows) {
    const key = `${r.equipmentId}|${r.fieldId}|${r.blockId ?? ''}`;
    if (!targets.has(key)) {
      targets.set(key, {
        equipmentId: r.equipmentId,
        fieldId: r.fieldId,
        blockId: r.blockId ?? null
      });
    }
    if (r.skippedAt) {
      const set = skips.get(r.equipmentId) ?? new Set<number>();
      set.add(r.skippedAt.getTime());
      skips.set(r.equipmentId, set);
    }
  }
  return {
    targets: [...targets.values()],
    skips: new Map([...skips].map(([k, v]) => [k, [...v].sort((a, b) => a - b)]))
  };
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
