/**
 * Crop ↔ Equipment binding repo (Phase 13 / 12E).
 *
 * Lets the operator pre-assign equipment to a specific crop so the calendar
 * engine + task system can suggest the right machine when scheduling work
 * (e.g., the corn crop's sprayer, the alfalfa crop's baler).
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from './client';
import { cropEquipment, equipment } from './schema';

export type CropEquipmentRole =
  | 'planter'
  | 'sprayer'
  | 'baler'
  | 'mower'
  | 'tedder'
  | 'rake'
  | 'irrigation'
  | 'tractor'
  | 'other';

export const CROP_EQUIPMENT_ROLES: CropEquipmentRole[] = [
  'planter',
  'sprayer',
  'baler',
  'mower',
  'tedder',
  'rake',
  'irrigation',
  'tractor',
  'other'
];

export interface CropEquipmentBinding {
  id: string;
  cropId: string;
  equipmentId: string;
  role: CropEquipmentRole;
  notes?: string;
  createdAt: number;
  /** Hydrated equipment metadata for UI cards. */
  equipmentLabel: string;
  equipmentType: string;
  equipmentRetiredAt?: number;
}

export function listCropEquipment(cropId: string): CropEquipmentBinding[] {
  const rows = db
    .select({
      id: cropEquipment.id,
      cropId: cropEquipment.cropId,
      equipmentId: cropEquipment.equipmentId,
      role: cropEquipment.role,
      notes: cropEquipment.notes,
      createdAt: cropEquipment.createdAt,
      equipmentLabel: equipment.label,
      equipmentType: equipment.type,
      equipmentRetiredAt: equipment.retiredAt
    })
    .from(cropEquipment)
    .innerJoin(equipment, eq(cropEquipment.equipmentId, equipment.id))
    .where(eq(cropEquipment.cropId, cropId))
    .all();
  return rows.map((r) => ({
    id: r.id,
    cropId: r.cropId,
    equipmentId: r.equipmentId,
    role: r.role as CropEquipmentRole,
    notes: r.notes ?? undefined,
    createdAt: r.createdAt.getTime(),
    equipmentLabel: r.equipmentLabel,
    equipmentType: r.equipmentType,
    equipmentRetiredAt: r.equipmentRetiredAt?.getTime()
  }));
}

export function listCropsForEquipment(equipmentId: string): { cropId: string; role: CropEquipmentRole }[] {
  const rows = db
    .select({ cropId: cropEquipment.cropId, role: cropEquipment.role })
    .from(cropEquipment)
    .where(eq(cropEquipment.equipmentId, equipmentId))
    .all();
  return rows.map((r) => ({ cropId: r.cropId, role: r.role as CropEquipmentRole }));
}

export class CropEquipmentBindingExistsError extends Error {
  constructor() {
    super('this equipment is already bound to that crop in that role');
    this.name = 'CropEquipmentBindingExistsError';
  }
}

export function bindEquipment(input: {
  cropId: string;
  equipmentId: string;
  role: CropEquipmentRole;
  notes?: string;
}): CropEquipmentBinding {
  const existing = db
    .select({ id: cropEquipment.id })
    .from(cropEquipment)
    .where(
      and(
        eq(cropEquipment.cropId, input.cropId),
        eq(cropEquipment.equipmentId, input.equipmentId),
        eq(cropEquipment.role, input.role)
      )
    )
    .get();
  if (existing) throw new CropEquipmentBindingExistsError();

  const id = randomUUID();
  db.insert(cropEquipment)
    .values({
      id,
      cropId: input.cropId,
      equipmentId: input.equipmentId,
      role: input.role,
      notes: input.notes ?? null
    })
    .run();
  // Re-fetch through the join so the caller gets equipment metadata.
  const out = listCropEquipment(input.cropId).find((b) => b.id === id);
  if (!out) throw new Error('binding insert succeeded but lookup failed');
  return out;
}

export function unbindEquipment(bindingId: string): boolean {
  const r = db.delete(cropEquipment).where(eq(cropEquipment.id, bindingId)).run();
  return r.changes > 0;
}

/** Cascade-helper used by deleteCropCascade and deleteEquipmentCascade. */
export function deleteBindingsForCrop(cropId: string): number {
  return db.delete(cropEquipment).where(eq(cropEquipment.cropId, cropId)).run().changes;
}

export function deleteBindingsForEquipment(equipmentId: string): number {
  return db.delete(cropEquipment).where(eq(cropEquipment.equipmentId, equipmentId)).run().changes;
}
