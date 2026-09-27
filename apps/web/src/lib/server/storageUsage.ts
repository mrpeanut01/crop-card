/**
 * Storage a farm uses, computed from the rows that hold it rather than kept
 * as a running counter: planting journal photos and animal photos (both
 * stored inline as JPEG data URLs). The total is cached per Owner in `app_settings` and
 * recomputed nightly by `runDbMaintenance`; `owner_usage_counters.storage_bytes`
 * is never read.
 */

import { sql } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { animals, owners, plantingJournal } from '$lib/db/schema';
import { getSetting, setSetting } from '$lib/db/settings';
import { runWithTenant, unscopedQueryNote, withTenant } from '$lib/db/tenant';

export const STORAGE_SETTING_KEY = 'storage_usage';

export interface StorageUsage {
  bytes: number;
  journalPhotoBytes: number;
  animalPhotoBytes: number;
  computedAt: number;
}

function usageFrom(journalPhotoBytes: number, animalPhotoBytes: number, now: number): StorageUsage {
  return {
    bytes: journalPhotoBytes + animalPhotoBytes,
    journalPhotoBytes,
    animalPhotoBytes,
    computedAt: now
  };
}

function parseUsage(raw: string | undefined): StorageUsage | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StorageUsage>;
    if (
      typeof v.bytes !== 'number' ||
      typeof v.journalPhotoBytes !== 'number' ||
      typeof v.animalPhotoBytes !== 'number' ||
      typeof v.computedAt !== 'number'
    ) {
      return null;
    }
    return {
      bytes: v.bytes,
      journalPhotoBytes: v.journalPhotoBytes,
      animalPhotoBytes: v.animalPhotoBytes,
      computedAt: v.computedAt
    };
  } catch {
    return null;
  }
}

/** Sums the active Owner's stored bytes straight from the source rows. */
export function computeStorageUsage(now = Date.now()): StorageUsage {
  const row = db
    .select({ bytes: sql<number>`coalesce(sum(length(${plantingJournal.photoRef})), 0)` })
    .from(plantingJournal)
    .where(withTenant(plantingJournal))
    .get();
  const animalRow = db
    .select({ bytes: sql<number>`coalesce(sum(length(${animals.photoRef})), 0)` })
    .from(animals)
    .where(withTenant(animals))
    .get();
  return usageFrom(Number(row?.bytes ?? 0), Number(animalRow?.bytes ?? 0), now);
}

/** Recomputes and caches the active Owner's total. */
export function refreshStorageUsage(now = Date.now()): StorageUsage {
  const usage = computeStorageUsage(now);
  setSetting(STORAGE_SETTING_KEY, JSON.stringify(usage));
  return usage;
}

/** The cached total for the active Owner, computed on first read. */
export function storageUsage(now = Date.now()): StorageUsage {
  return parseUsage(getSetting(STORAGE_SETTING_KEY)) ?? refreshStorageUsage(now);
}

/** Recomputes every Owner's cached total with one grouped read. Returns how
 *  many Owners were written. */
export function recomputeAllStorageUsage(now = Date.now()): number {
  unscopedQueryNote('nightly storage recompute sums every Owner in one grouped read');
  const sums = new Map(
    db
      .select({
        ownerId: plantingJournal.ownerId,
        bytes: sql<number>`coalesce(sum(length(${plantingJournal.photoRef})), 0)`
      })
      .from(plantingJournal)
      .groupBy(plantingJournal.ownerId)
      .all()
      .map((r) => [r.ownerId, Number(r.bytes)] as const)
  );
  const animalSums = new Map(
    db
      .select({
        ownerId: animals.ownerId,
        bytes: sql<number>`coalesce(sum(length(${animals.photoRef})), 0)`
      })
      .from(animals)
      .groupBy(animals.ownerId)
      .all()
      .map((r) => [r.ownerId, Number(r.bytes)] as const)
  );
  const ownerIds = db
    .select({ id: owners.id })
    .from(owners)
    .all()
    .map((r) => r.id);
  for (const ownerId of ownerIds) {
    const usage = usageFrom(sums.get(ownerId) ?? 0, animalSums.get(ownerId) ?? 0, now);
    runWithTenant(ownerId, () => setSetting(STORAGE_SETTING_KEY, JSON.stringify(usage)));
  }
  return ownerIds.length;
}
