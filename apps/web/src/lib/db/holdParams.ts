/**
 * C-35: the hold parameters (label intervals) stored with each dose and
 * application when it is recorded, so a later change to plugin data can
 * only lengthen the hold. The hold guard writes them for new records inside
 * the record's own transaction; the kernels read the longer of this
 * snapshot and the current data.
 */

import { eq, isNotNull } from 'drizzle-orm';
import { db } from './client';
import { animalHealthEvents, fungicideEvents, insecticideEvents, sprayEvents } from './schema';
import { withTenant } from './tenant';

export type HoldParamsSource = 'spray' | 'insecticide' | 'fungicide' | 'animal-health';

const TABLES = {
  spray: sprayEvents,
  insecticide: insecticideEvents,
  fungicide: fungicideEvents,
  'animal-health': animalHealthEvents
} as const;

/** Every stored snapshot of one kind, by record id. */
export function readHoldParams(source: HoldParamsSource): Map<string, string> {
  const t = TABLES[source];
  const rows = db
    .select({ id: t.id, json: t.holdParamsJson })
    .from(t)
    .where(withTenant(t, isNotNull(t.holdParamsJson)))
    .all();
  return new Map(rows.map((r) => [r.id, r.json as string]));
}

/** When an application was saved, from its snapshot; null for rows saved
 *  before C-35 (they cannot be voided). */
export function recordedAtOf(
  source: Exclude<HoldParamsSource, 'animal-health'>,
  id: string
): number | null {
  const t = TABLES[source];
  const row = db
    .select({ json: t.holdParamsJson })
    .from(t)
    .where(withTenant(t, eq(t.id, id)))
    .get();
  if (!row?.json) return null;
  try {
    const v = JSON.parse(row.json) as { recordedAtMs?: unknown };
    return typeof v.recordedAtMs === 'number' ? v.recordedAtMs : null;
  } catch {
    return null;
  }
}

/** Stores a snapshot once; an existing one is never replaced. */
export function writeHoldParams(source: HoldParamsSource, id: string, json: string): void {
  const t = TABLES[source];
  const row = db
    .select({ json: t.holdParamsJson })
    .from(t)
    .where(withTenant(t, eq(t.id, id)))
    .get();
  if (!row || row.json) return;
  db.update(t)
    .set({ holdParamsJson: json })
    .where(withTenant(t, eq(t.id, id)))
    .run();
}
