/**
 * DB-backed sprayer repo (replaces the in-memory one from Phase 3).
 * Same surface area: list, get, recordSpray, recordDecon.
 *
 * Seeds CORN + PUMPKIN sprayers on first call so existing pages keep working.
 */

import { eq } from 'drizzle-orm';
import type { ChemistryClass } from '$lib/safety/types';
import { db } from './client';
import { sprayers } from './schema';

export interface Sprayer {
  id: string;
  label: string;
  calibratedGpa: number;
  calibrationDate?: number;
  lastChemistryClass?: ChemistryClass;
  lastSprayedAt?: number;
  lastDeconAt?: number;
}

const SEED: Sprayer[] = [
  { id: 'CORN', label: 'Corn-dedicated sprayer', calibratedGpa: 15 },
  { id: 'PUMPKIN', label: 'Pumpkin/bean-dedicated sprayer', calibratedGpa: 15 }
];

let seeded = false;
function ensureSeeded() {
  if (seeded) return;
  for (const s of SEED) {
    const exists = db.select().from(sprayers).where(eq(sprayers.id, s.id)).get();
    if (!exists) {
      db.insert(sprayers).values({
        id: s.id,
        label: s.label,
        calibratedGpa: s.calibratedGpa
      }).run();
    }
  }
  seeded = true;
}

function rowToSprayer(row: typeof sprayers.$inferSelect): Sprayer {
  return {
    id: row.id,
    label: row.label,
    calibratedGpa: row.calibratedGpa ?? 15,
    calibrationDate: row.calibrationDate?.getTime(),
    lastChemistryClass: row.lastChemistryClass as ChemistryClass | undefined,
    lastSprayedAt: row.lastSprayedAt?.getTime(),
    lastDeconAt: row.lastDeconAt?.getTime()
  };
}

export function listSprayers(): Sprayer[] {
  ensureSeeded();
  return db.select().from(sprayers).all().map(rowToSprayer);
}

export function getSprayer(id: string): Sprayer | undefined {
  ensureSeeded();
  const row = db.select().from(sprayers).where(eq(sprayers.id, id)).get();
  return row ? rowToSprayer(row) : undefined;
}

export function recordSpray(
  id: string,
  chemistry: ChemistryClass,
  occurredAt: number
): Sprayer {
  ensureSeeded();
  const updated = db
    .update(sprayers)
    .set({ lastChemistryClass: chemistry, lastSprayedAt: new Date(occurredAt) })
    .where(eq(sprayers.id, id))
    .returning()
    .get();
  if (!updated) throw new Error(`unknown sprayer: ${id}`);
  return rowToSprayer(updated);
}

export function recordDecon(id: string, completedAt: number): Sprayer {
  ensureSeeded();
  const updated = db
    .update(sprayers)
    .set({ lastDeconAt: new Date(completedAt) })
    .where(eq(sprayers.id, id))
    .returning()
    .get();
  if (!updated) throw new Error(`unknown sprayer: ${id}`);
  return rowToSprayer(updated);
}

export function recordCalibration(
  id: string,
  calibratedGpa: number,
  calibratedAt: number = Date.now()
): Sprayer {
  ensureSeeded();
  if (!Number.isFinite(calibratedGpa) || calibratedGpa <= 0) {
    throw new Error('calibratedGpa must be positive');
  }
  const updated = db
    .update(sprayers)
    .set({
      calibratedGpa: Math.round(calibratedGpa),
      calibrationDate: new Date(calibratedAt)
    })
    .where(eq(sprayers.id, id))
    .returning()
    .get();
  if (!updated) throw new Error(`unknown sprayer: ${id}`);
  return rowToSprayer(updated);
}
