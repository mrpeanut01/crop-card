/**
 * Seed-starting trays (Phase 32E, E1). One row per tray. Every write
 * recomputes the planting's `crops.sown_indoors_at` as the earliest
 * `sown_at` of its trays, in the same transaction (ruling E1-16).
 */

import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lte, min, or, sql } from 'drizzle-orm';
import { db } from './client';
import { crops, seedStarts } from './schema';
import { tenantValues, withTenant } from './tenant';

export interface SeedStart {
  id: string;
  cropId: string;
  sownAt: number;
  trayLabel: string | null;
  cells: number | null;
  seedsPerCell: number | null;
  locationAreaId: string | null;
  locationText: string | null;
  stockLotId: string | null;
  germinatedCount: number | null;
  germinatedAt: number | null;
  hardenStartedAt: number | null;
  transplantedAt: number | null;
  performedById: string | null;
}

type Row = typeof seedStarts.$inferSelect;

function toSeedStart(r: Row): SeedStart {
  return {
    id: r.id,
    cropId: r.cropId,
    sownAt: r.sownAt.getTime(),
    trayLabel: r.trayLabel,
    cells: r.cells,
    seedsPerCell: r.seedsPerCell,
    locationAreaId: r.locationAreaId,
    locationText: r.locationText,
    stockLotId: r.stockLotId,
    germinatedCount: r.germinatedCount,
    germinatedAt: r.germinatedAt?.getTime() ?? null,
    hardenStartedAt: r.hardenStartedAt?.getTime() ?? null,
    transplantedAt: r.transplantedAt?.getTime() ?? null,
    performedById: r.performedById
  };
}

export function getSeedStart(id: string): SeedStart | undefined {
  const row = db
    .select()
    .from(seedStarts)
    .where(withTenant(seedStarts, eq(seedStarts.id, id)))
    .get();
  return row ? toSeedStart(row) : undefined;
}

/** Trays of the given plantings, oldest sowing first, in one query. */
export function listSeedStartsForCrops(cropIds: readonly string[]): SeedStart[] {
  if (cropIds.length === 0) return [];
  return db
    .select()
    .from(seedStarts)
    .where(withTenant(seedStarts, inArray(seedStarts.cropId, [...cropIds])))
    .orderBy(asc(seedStarts.sownAt), asc(seedStarts.id))
    .all()
    .map(toSeedStart);
}

/** Every tray of the farm that has not gone into the ground. */
export function listOpenSeedStarts(): SeedStart[] {
  return db
    .select()
    .from(seedStarts)
    .where(withTenant(seedStarts, isNull(seedStarts.transplantedAt)))
    .orderBy(asc(seedStarts.sownAt), asc(seedStarts.id))
    .all()
    .map(toSeedStart);
}

/** Sets `crops.sown_indoors_at` to the earliest tray sowing, or null. */
export function recomputeSownIndoorsAt(cropId: string): number | null {
  const row = db
    .select({ first: min(seedStarts.sownAt) })
    .from(seedStarts)
    .where(withTenant(seedStarts, eq(seedStarts.cropId, cropId)))
    .get();
  const first = row?.first ?? null;
  const ms = first == null ? null : first instanceof Date ? first.getTime() : Number(first);
  db.update(crops)
    .set({ sownIndoorsAt: ms == null ? null : new Date(ms) })
    .where(withTenant(crops, eq(crops.id, cropId)))
    .run();
  return ms;
}

export interface SeedStartFields {
  trayLabel?: string | null;
  cells?: number | null;
  seedsPerCell?: number | null;
  locationAreaId?: string | null;
  locationText?: string | null;
  stockLotId?: string | null;
}

export function createSeedStart(
  input: SeedStartFields & {
    cropId: string;
    sownAt: number;
    performedById: string | null;
  }
): SeedStart {
  return db.transaction(() => {
    const id = randomUUID();
    db.insert(seedStarts)
      .values(
        tenantValues({
          id,
          cropId: input.cropId,
          sownAt: new Date(input.sownAt),
          trayLabel: input.trayLabel ?? null,
          cells: input.cells ?? null,
          seedsPerCell: input.seedsPerCell ?? null,
          locationAreaId: input.locationAreaId ?? null,
          locationText: input.locationText ?? null,
          stockLotId: input.stockLotId ?? null,
          performedById: input.performedById
        })
      )
      .run();
    recomputeSownIndoorsAt(input.cropId);
    return getSeedStart(id)!;
  });
}

export function updateSeedStart(
  id: string,
  patch: SeedStartFields & { sownAt?: number }
): SeedStart | undefined {
  return db.transaction(() => {
    const before = getSeedStart(id);
    if (!before) return undefined;
    const set: Partial<typeof seedStarts.$inferInsert> = { updatedAt: new Date() };
    if (patch.sownAt !== undefined) set.sownAt = new Date(patch.sownAt);
    if (patch.trayLabel !== undefined) set.trayLabel = patch.trayLabel;
    if (patch.cells !== undefined) set.cells = patch.cells;
    if (patch.seedsPerCell !== undefined) set.seedsPerCell = patch.seedsPerCell;
    if (patch.locationAreaId !== undefined) set.locationAreaId = patch.locationAreaId;
    if (patch.locationText !== undefined) set.locationText = patch.locationText;
    if (patch.stockLotId !== undefined) set.stockLotId = patch.stockLotId;
    db.update(seedStarts)
      .set(set)
      .where(withTenant(seedStarts, eq(seedStarts.id, id)))
      .run();
    recomputeSownIndoorsAt(before.cropId);
    return getSeedStart(id);
  });
}

/**
 * Helper chores on a tray. The germination count is absolute; the value
 * with the latest `observedAt` wins, so an older replay never overwrites a
 * newer count (E1-15). Hardening and transplant dates are set once and
 * never moved later by a replay.
 */
export function recordSeedStartProgress(
  id: string,
  input: {
    germinatedCount?: number;
    observedAt: number;
    hardenStartedAt?: number;
    transplantedAt?: number;
  }
): { tray: SeedStart; countApplied: boolean } | undefined {
  return db.transaction(() => {
    const before = getSeedStart(id);
    if (!before) return undefined;
    let countApplied = false;
    if (input.germinatedCount !== undefined) {
      const res = db
        .update(seedStarts)
        .set({
          germinatedCount: input.germinatedCount,
          germinatedAt: new Date(input.observedAt),
          updatedAt: new Date()
        })
        .where(
          withTenant(
            seedStarts,
            and(
              eq(seedStarts.id, id),
              or(
                isNull(seedStarts.germinatedAt),
                lte(seedStarts.germinatedAt, new Date(input.observedAt))
              )
            )
          )
        )
        .run();
      countApplied = res.changes > 0;
    }
    if (input.hardenStartedAt !== undefined) {
      db.update(seedStarts)
        .set({
          hardenStartedAt: sql`coalesce(min(${seedStarts.hardenStartedAt}, ${input.hardenStartedAt}), ${input.hardenStartedAt})`
        })
        .where(withTenant(seedStarts, eq(seedStarts.id, id)))
        .run();
    }
    if (input.transplantedAt !== undefined) {
      db.update(seedStarts)
        .set({
          transplantedAt: sql`coalesce(min(${seedStarts.transplantedAt}, ${input.transplantedAt}), ${input.transplantedAt})`
        })
        .where(withTenant(seedStarts, eq(seedStarts.id, id)))
        .run();
    }
    return { tray: getSeedStart(id)!, countApplied };
  });
}

/** Closing the Transplant task stamps the planting's trays that have no
 *  transplant date yet (E1-17). */
export function stampTraysTransplanted(cropId: string, atMs: number): number {
  return db
    .update(seedStarts)
    .set({ transplantedAt: new Date(atMs), updatedAt: new Date() })
    .where(
      withTenant(seedStarts, and(eq(seedStarts.cropId, cropId), isNull(seedStarts.transplantedAt)))
    )
    .run().changes;
}

export function cropHasSeedStarts(cropId: string): boolean {
  return (
    db
      .select({ id: seedStarts.id })
      .from(seedStarts)
      .where(withTenant(seedStarts, eq(seedStarts.cropId, cropId)))
      .limit(1)
      .get() !== undefined
  );
}
