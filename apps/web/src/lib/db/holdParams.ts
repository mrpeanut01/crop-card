/**
 * C-35: the hold parameters (label intervals) stored with each dose and
 * application when it is recorded, so a later change to plugin data can
 * only lengthen the hold. The hold guard writes them for new records inside
 * the record's own transaction; the kernels read the longer of this
 * snapshot and the current data.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from './client';
import {
  animalHealthEvents,
  fungicideEvents,
  insecticideEvents,
  recordDeletions,
  sprayEvents
} from './schema';
import { withTenant } from './tenant';

export type HoldParamsSource = 'spray' | 'insecticide' | 'fungicide' | 'animal-health';

const TABLES = {
  spray: sprayEvents,
  insecticide: insecticideEvents,
  fungicide: fungicideEvents,
  'animal-health': animalHealthEvents
} as const;

type ApplicationSource = Exclude<HoldParamsSource, 'animal-health'>;

function parseSnapshot(json: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function applicationTombstones(source: ApplicationSource, recordId?: string) {
  return db
    .select({
      id: recordDeletions.id,
      recordId: recordDeletions.recordId,
      json: recordDeletions.snapshotJson
    })
    .from(recordDeletions)
    .where(
      withTenant(
        recordDeletions,
        recordId === undefined
          ? eq(recordDeletions.recordKind, source)
          : and(eq(recordDeletions.recordKind, source), eq(recordDeletions.recordId, recordId))
      )
    )
    .all();
}

/**
 * Every stored snapshot of one kind, by record id. A deleted application
 * keeps its snapshot on its tombstone (C-26 + C-35), so its grazing and hay
 * holds cannot be shortened by later plugin data either.
 */
export function readHoldParams(source: HoldParamsSource): Map<string, string> {
  const t = TABLES[source];
  const rows = db
    .select({ id: t.id, json: t.holdParamsJson })
    .from(t)
    .where(withTenant(t, isNotNull(t.holdParamsJson)))
    .all();
  const out = new Map(rows.map((r) => [r.id, r.json as string]));
  if (source === 'animal-health') return out;
  for (const row of applicationTombstones(source)) {
    if (out.has(row.recordId)) continue;
    const json = parseSnapshot(row.json)?.holdParamsJson;
    if (typeof json === 'string') out.set(row.recordId, json);
  }
  return out;
}

/** The snapshot a live application carries now, for its tombstone. */
export function liveHoldParams(source: ApplicationSource, id: string): string | null {
  const t = TABLES[source];
  const row = db
    .select({ json: t.holdParamsJson })
    .from(t)
    .where(withTenant(t, eq(t.id, id)))
    .get();
  return row?.json ?? null;
}

/** Whether a tombstoned application still needs a snapshot. */
export function tombstoneNeedsHoldParams(snapshotJson: string): boolean {
  const snap = parseSnapshot(snapshotJson);
  if (!snap || snap.neverApplied === true) return false;
  return typeof snap.holdParamsJson !== 'string';
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
  if (!row) {
    if (source !== 'animal-health') writeTombstoneHoldParams(source, id, json);
    return;
  }
  if (row.json) return;
  db.update(t)
    .set({ holdParamsJson: json })
    .where(withTenant(t, eq(t.id, id)))
    .run();
}

function writeTombstoneHoldParams(source: ApplicationSource, id: string, json: string): void {
  for (const row of applicationTombstones(source, id)) {
    if (!tombstoneNeedsHoldParams(row.json)) continue;
    const snap = parseSnapshot(row.json);
    if (!snap) continue;
    db.update(recordDeletions)
      .set({ snapshotJson: JSON.stringify({ ...snap, holdParamsJson: json }) })
      .where(withTenant(recordDeletions, eq(recordDeletions.id, row.id)))
      .run();
  }
}

/**
 * Replaces a live dose's snapshot. Only the hold guard calls it, to add the
 * label data of a product an owner entry named; the keys already stored are
 * carried over unchanged, so no stored reading is ever replaced.
 */
export function extendDoseHoldParams(id: string, json: string): void {
  const t = animalHealthEvents;
  db.update(t)
    .set({ holdParamsJson: json })
    .where(withTenant(t, eq(t.id, id)))
    .run();
}
