/**
 * Equipment repo (Phase 8a). Replaces the legacy `sprayers` repo for new
 * code; sprayers stays as vestigial back-compat. The id namespace is shared
 * (sprayer ids are reused as equipment ids during backfill) so existing
 * spray_events.sprayer_id rows continue to resolve.
 *
 * Sprayer-typed equipment carries chemistry-history + decon + GPA-calibration
 * state on equipment_state, which the safety kernel reads on every spray.
 *
 * Phase 18a: tenant-scoped. The legacy boot-time seeding of CORN/PUMPKIN
 * sprayers is now retired — that bootstrap was a single-farm concession and
 * is replaced by the per-Owner onboarding wizard (Phase 18f) for new
 * tenants. Home Farm's existing rows are stamped by the backfill migration.
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { ChemistryClass } from '$lib/safety/types';
import { db } from './client';
import { equipment, equipmentLog, equipmentState } from './schema';
import { tenantValues, tenantWhere, withTenant } from './tenant';

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
  typeId?: string;
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

function rowToEquipment(row: typeof equipment.$inferSelect): Equipment {
  return {
    id: row.id,
    type: row.type as EquipmentType,
    typeId: row.typeId ?? undefined,
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
  let q = db
    .select()
    .from(equipment)
    .where(withTenant(equipment, filter?.type ? eq(equipment.type, filter.type) : undefined))
    .$dynamic();
  const rows = q.all();
  return rows.map((r) => {
    const stateRow = db
      .select()
      .from(equipmentState)
      .where(withTenant(equipmentState, eq(equipmentState.equipmentId, r.id)))
      .get();
    const state = stateRow ? rowToState(stateRow) : { equipmentId: r.id };
    return { ...rowToEquipment(r), state };
  });
}

export function getEquipment(id: string): EquipmentWithState | undefined {
  const row = db
    .select()
    .from(equipment)
    .where(withTenant(equipment, eq(equipment.id, id)))
    .get();
  if (!row) return undefined;
  const stateRow = db
    .select()
    .from(equipmentState)
    .where(withTenant(equipmentState, eq(equipmentState.equipmentId, id)))
    .get();
  const state = stateRow ? rowToState(stateRow) : { equipmentId: id };
  return { ...rowToEquipment(row), state };
}

export interface CreateEquipmentInput {
  type: EquipmentType;
  typeId?: string;
  label: string;
  spec?: Record<string, unknown>;
  notes?: string;
}

export function createEquipment(input: CreateEquipmentInput): Equipment {
  const id = randomUUID();
  const row = db
    .insert(equipment)
    .values(
      tenantValues({
        id,
        type: input.type,
        typeId: input.typeId ?? null,
        label: input.label,
        specJson: input.spec ? JSON.stringify(input.spec) : null,
        notes: input.notes ?? null
      })
    )
    .returning()
    .get();
  db.insert(equipmentState).values(tenantValues({ equipmentId: id })).run();
  return rowToEquipment(row);
}

export function updateEquipment(
  id: string,
  patch: { label?: string; notes?: string }
): Equipment {
  const set: Partial<typeof equipment.$inferInsert> = {};
  if (patch.label !== undefined) set.label = patch.label;
  if (patch.notes !== undefined) set.notes = patch.notes || null;
  if (Object.keys(set).length === 0) {
    const row = db
      .select()
      .from(equipment)
      .where(withTenant(equipment, eq(equipment.id, id)))
      .get();
    if (!row) throw new Error(`unknown equipment: ${id}`);
    return rowToEquipment(row);
  }
  const updated = db
    .update(equipment)
    .set(set)
    .where(withTenant(equipment, eq(equipment.id, id)))
    .returning()
    .get();
  if (!updated) throw new Error(`unknown equipment: ${id}`);
  return rowToEquipment(updated);
}

export function updateEquipmentState(
  id: string,
  patch: Partial<Omit<EquipmentStateRow, 'equipmentId'>>
): EquipmentStateRow {
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
    .where(withTenant(equipmentState, eq(equipmentState.equipmentId, id)))
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
  const id = randomUUID();
  const occurredAt = input.occurredAt ?? Date.now();
  const row = db
    .insert(equipmentLog)
    .values(
      tenantValues({
        id,
        equipmentId: input.equipmentId,
        kind: input.kind,
        occurredAt: new Date(occurredAt),
        performedById: input.performedById ?? null,
        notes: input.notes ?? null,
        payloadJson: input.payload ? JSON.stringify(input.payload) : null
      })
    )
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
  const conds = [eq(equipmentLog.equipmentId, equipmentId)];
  if (opts?.kind) conds.push(eq(equipmentLog.kind, opts.kind));
  let q = db
    .select()
    .from(equipmentLog)
    .where(withTenant(equipmentLog, and(...conds)))
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

// Re-export for unused-import discipline; the listing functions above wire
// tenantWhere through withTenant.
void tenantWhere;
