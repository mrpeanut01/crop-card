/**
 * Legacy sprayer adapter (Phase 8a).
 *
 * Phase 8a unified all field gear under `equipment`. The repo here remains
 * for back-compat with existing call sites (every endpoint that referenced
 * a "sprayer" by id) and now reads/writes against the equipment + state
 * tables filtered to `type='sprayer'`. New code should import from
 * `$lib/db/equipment` directly.
 */

import { appendEquipmentLog, getEquipment, listEquipment, updateEquipmentState } from './equipment';
import type { ChemistryClass } from '$lib/safety/types';

export interface Sprayer {
  id: string;
  label: string;
  calibratedGpa: number;
  calibrationDate?: number;
  lastChemistryClass?: ChemistryClass;
  lastSprayedAt?: number;
  lastDeconAt?: number;
}

function toSprayer(eq: ReturnType<typeof listEquipment>[number]): Sprayer {
  return {
    id: eq.id,
    label: eq.label,
    calibratedGpa: eq.state.calibratedGpa ?? 15,
    calibrationDate: eq.state.calibrationDate,
    lastChemistryClass: eq.state.lastChemistryClass,
    lastSprayedAt: eq.state.lastUsedAt,
    lastDeconAt: eq.state.lastDeconAt
  };
}

// Bootstrap (CORN + PUMPKIN seed) lives in equipment.ts so both repos
// converge on the same canonical id space.

export function listSprayers(): Sprayer[] {
  return listEquipment({ type: 'sprayer' }).map(toSprayer);
}

export function getSprayer(id: string): Sprayer | undefined {
  const eq = getEquipment(id);
  if (!eq || eq.type !== 'sprayer') return undefined;
  return toSprayer(eq);
}

export function recordSpray(id: string, chemistry: ChemistryClass, occurredAt: number): Sprayer {
  updateEquipmentState(id, {
    lastChemistryClass: chemistry,
    lastUsedAt: occurredAt
  });
  appendEquipmentLog({
    equipmentId: id,
    kind: 'use',
    occurredAt,
    payload: { chemistryClass: chemistry }
  });
  const out = getSprayer(id);
  if (!out) throw new Error(`unknown sprayer: ${id}`);
  return out;
}

export function recordDecon(id: string, completedAt: number): Sprayer {
  updateEquipmentState(id, { lastDeconAt: completedAt });
  appendEquipmentLog({
    equipmentId: id,
    kind: 'decon',
    occurredAt: completedAt
  });
  const out = getSprayer(id);
  if (!out) throw new Error(`unknown sprayer: ${id}`);
  return out;
}

export function recordCalibration(
  id: string,
  calibratedGpa: number,
  calibratedAt: number = Date.now()
): Sprayer {
  if (!Number.isFinite(calibratedGpa) || calibratedGpa <= 0) {
    throw new Error('calibratedGpa must be positive');
  }
  updateEquipmentState(id, {
    calibratedGpa: Math.round(calibratedGpa),
    calibrationDate: calibratedAt
  });
  appendEquipmentLog({
    equipmentId: id,
    kind: 'calibration',
    occurredAt: calibratedAt,
    payload: { calibratedGpa: Math.round(calibratedGpa) }
  });
  const out = getSprayer(id);
  if (!out) throw new Error(`unknown sprayer: ${id}`);
  return out;
}
