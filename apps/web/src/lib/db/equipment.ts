/**
 * Equipment repo (Phase 8a). Replaces the legacy `sprayers` repo for new
 * code; sprayers stays as vestigial back-compat. The id namespace is shared
 * (sprayer ids are reused as equipment ids during backfill) so existing
 * spray_events.sprayer_id rows continue to resolve.
 *
 * Sprayer-typed equipment carries chemistry-history + decon + GPA-calibration
 * state on equipment_state, which the safety kernel reads on every spray.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { ChemistryClass } from '$lib/safety/types';
import { db } from './client';
import { equipment, equipmentLog, equipmentState, sprayers } from './schema';

export type EquipmentType =
  | 'sprayer'
  | 'planter'
  | 'drill'
  | 'rake'
  | 'baler'
  | 'tractor'
  | 'mower'
  | 'irrigation'
  | 'other';

export type EquipmentLogKind =
  | 'use'
  | 'maintenance'
  | 'calibration'
  | 'decon'
  | 'inspection'
  | 'note';

export interface Equipment {
  id: string;
  type: EquipmentType;
  label: string;
  spec?: Record<string, unknown>;
  notes?: string;
  retiredAt?: number;
}

export interface EquipmentStateRow {
  equipmentId: string;
  hourMeter?: number;
  lastChemistryClass?: ChemistryClass;
  lastUsedAt?: number;
  lastDeconAt?: number;
  calibratedGpa?: number;
  calibrationDate?: number;
}

export interface EquipmentWithState extends Equipment {
  state: EquipmentStateRow;
}

export interface EquipmentLogEntry {
  id: string;
  equipmentId: string;
  occurredAt: number;
  kind: EquipmentLogKind;
  performedById?: string;
  notes?: string;
  payload?: Record<string, unknown>;
}

let seeded = false;

const CANONICAL_SPRAYERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'CORN', label: 'Corn-dedicated sprayer' },
  { id: 'PUMPKIN', label: 'Pumpkin/bean-dedicated sprayer' }
];

function ensureSeeded() {
  if (seeded) return;
  // Backfill any sprayer rows that don't yet exist as equipment. The id is
  // preserved so spray_events.sprayer_id continues to resolve.
  const legacy = db.select().from(sprayers).all();
  for (const s of legacy) {
    const exists = db.select().from(equipment).where(eq(equipment.id, s.id)).get();
    if (exists) continue;
    db.insert(equipment)
      .values({
        id: s.id,
        type: 'sprayer',
        label: s.label,
        notes: 'migrated from legacy sprayers table'
      })
      .run();
    db.insert(equipmentState)
      .values({
        equipmentId: s.id,
        calibratedGpa: s.calibratedGpa ?? null,
        calibrationDate: s.calibrationDate,
        lastChemistryClass: s.lastChemistryClass,
        lastUsedAt: s.lastSprayedAt,
        lastDeconAt: s.lastDeconAt
      })
      .run();
  }

  // Bootstrap canonical CORN/PUMPKIN sprayers on a fresh DB. Done here so
  // legacy sprayer-id semantics keep working across both tables.
  for (const seed of CANONICAL_SPRAYERS) {
    const exists = db.select().from(equipment).where(eq(equipment.id, seed.id)).get();
    if (exists) continue;
    db.insert(equipment).values({ id: seed.id, type: 'sprayer', label: seed.label }).run();
    db.insert(equipmentState).values({ equipmentId: seed.id, calibratedGpa: 15 }).run();
  }

  seeded = true;
}

function rowToEquipment(row: typeof equipment.$inferSelect): Equipment {
  return {
    id: row.id,
    type: row.type as EquipmentType,
    label: row.label,
    spec: row.specJson ? safeJson(row.specJson) : undefined,
    notes: row.notes ?? undefined,
    retiredAt: row.retiredAt?.getTime()
  };
}

function rowToState(row: typeof equipmentState.$inferSelect): EquipmentStateRow {
  return {
    equipmentId: row.equipmentId,
    hourMeter: row.hourMeter ?? undefined,
    lastChemistryClass: (row.lastChemistryClass as ChemistryClass | null) ?? undefined,
    lastUsedAt: row.lastUsedAt?.getTime(),
    lastDeconAt: row.lastDeconAt?.getTime(),
    calibratedGpa: row.calibratedGpa ?? undefined,
    calibrationDate: row.calibrationDate?.getTime()
  };
}

function safeJson(s: string): Record<string, unknown> | undefined {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function listEquipment(filter?: { type?: EquipmentType }): EquipmentWithState[] {
  ensureSeeded();
  let q = db.select().from(equipment).$dynamic();
  if (filter?.type) q = q.where(eq(equipment.type, filter.type));
  const rows = q.all();
  return rows.map((r) => {
    const stateRow = db
      .select()
      .from(equipmentState)
      .where(eq(equipmentState.equipmentId, r.id))
      .get();
    const state = stateRow
      ? rowToState(stateRow)
      : {
          equipmentId: r.id
        };
    return { ...rowToEquipment(r), state };
  });
}

export function getEquipment(id: string): EquipmentWithState | undefined {
  ensureSeeded();
  const row = db.select().from(equipment).where(eq(equipment.id, id)).get();
  if (!row) return undefined;
  const stateRow = db.select().from(equipmentState).where(eq(equipmentState.equipmentId, id)).get();
  const state = stateRow ? rowToState(stateRow) : { equipmentId: id };
  return { ...rowToEquipment(row), state };
}

export interface CreateEquipmentInput {
  type: EquipmentType;
  label: string;
  spec?: Record<string, unknown>;
  notes?: string;
}

export function createEquipment(input: CreateEquipmentInput): Equipment {
  ensureSeeded();
  const id = randomUUID();
  const row = db
    .insert(equipment)
    .values({
      id,
      type: input.type,
      label: input.label,
      specJson: input.spec ? JSON.stringify(input.spec) : null,
      notes: input.notes ?? null
    })
    .returning()
    .get();
  db.insert(equipmentState).values({ equipmentId: id }).run();
  return rowToEquipment(row);
}

export function updateEquipmentState(
  id: string,
  patch: Partial<Omit<EquipmentStateRow, 'equipmentId'>>
): EquipmentStateRow {
  ensureSeeded();
  const set: Partial<typeof equipmentState.$inferInsert> = {};
  if (patch.hourMeter !== undefined) set.hourMeter = patch.hourMeter;
  if (patch.lastChemistryClass !== undefined) set.lastChemistryClass = patch.lastChemistryClass;
  if (patch.lastUsedAt !== undefined)
    set.lastUsedAt = patch.lastUsedAt ? new Date(patch.lastUsedAt) : null;
  if (patch.lastDeconAt !== undefined)
    set.lastDeconAt = patch.lastDeconAt ? new Date(patch.lastDeconAt) : null;
  if (patch.calibratedGpa !== undefined) set.calibratedGpa = patch.calibratedGpa;
  if (patch.calibrationDate !== undefined)
    set.calibrationDate = patch.calibrationDate ? new Date(patch.calibrationDate) : null;
  const updated = db
    .update(equipmentState)
    .set(set)
    .where(eq(equipmentState.equipmentId, id))
    .returning()
    .get();
  if (!updated) throw new Error(`unknown equipment: ${id}`);
  return rowToState(updated);
}

export function appendEquipmentLog(input: {
  equipmentId: string;
  kind: EquipmentLogKind;
  occurredAt?: number;
  performedById?: string;
  notes?: string;
  payload?: Record<string, unknown>;
}): EquipmentLogEntry {
  ensureSeeded();
  const id = randomUUID();
  const occurredAt = input.occurredAt ?? Date.now();
  const row = db
    .insert(equipmentLog)
    .values({
      id,
      equipmentId: input.equipmentId,
      kind: input.kind,
      occurredAt: new Date(occurredAt),
      performedById: input.performedById ?? null,
      notes: input.notes ?? null,
      payloadJson: input.payload ? JSON.stringify(input.payload) : null
    })
    .returning()
    .get();
  return {
    id: row.id,
    equipmentId: row.equipmentId,
    occurredAt: row.occurredAt.getTime(),
    kind: row.kind as EquipmentLogKind,
    performedById: row.performedById ?? undefined,
    notes: row.notes ?? undefined,
    payload: row.payloadJson ? safeJson(row.payloadJson) : undefined
  };
}

export function listEquipmentLog(
  equipmentId: string,
  opts?: { kind?: EquipmentLogKind; limit?: number }
): EquipmentLogEntry[] {
  ensureSeeded();
  const conds = [eq(equipmentLog.equipmentId, equipmentId)];
  if (opts?.kind) conds.push(eq(equipmentLog.kind, opts.kind));
  let q = db
    .select()
    .from(equipmentLog)
    .where(and(...conds))
    .orderBy(desc(equipmentLog.occurredAt))
    .$dynamic();
  if (opts?.limit) q = q.limit(opts.limit);
  return q.all().map((r) => ({
    id: r.id,
    equipmentId: r.equipmentId,
    occurredAt: r.occurredAt.getTime(),
    kind: r.kind as EquipmentLogKind,
    performedById: r.performedById ?? undefined,
    notes: r.notes ?? undefined,
    payload: r.payloadJson ? safeJson(r.payloadJson) : undefined
  }));
}
