/**
 * Storage a farm uses, computed from the rows that hold it rather than kept
 * as a running counter: planting journal photos and animal photos (the
 * vault documents plus the inline data URLs not moved yet) and the other
 * files in the document vault (A-52). The total is cached per Owner in `app_settings` and
 * recomputed nightly by `runDbMaintenance`; `owner_usage_counters.storage_bytes`
 * is never read.
 */

import { isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { animals, documents, owners, plantingJournal } from '$lib/db/schema';
import { getSetting, setSetting } from '$lib/db/settings';
import { runWithTenant, unscopedQueryNote, withTenant } from '$lib/db/tenant';

export const STORAGE_SETTING_KEY = 'storage_usage';

export interface StorageUsage {
  /** Everything below added up; what /admin/owners shows. */
  bytes: number;
  journalPhotoBytes: number;
  animalPhotoBytes: number;
  /** Live vault files that are not journal or animal photos. */
  documentBytes: number;
  computedAt: number;
}

interface Parts {
  journalPhotoBytes: number;
  animalPhotoBytes: number;
  documentBytes: number;
}

const NO_PARTS: Parts = { journalPhotoBytes: 0, animalPhotoBytes: 0, documentBytes: 0 };

function usageFrom(parts: Parts, now: number): StorageUsage {
  return {
    bytes: parts.journalPhotoBytes + parts.animalPhotoBytes + parts.documentBytes,
    ...parts,
    computedAt: now
  };
}

/** Live vault bytes by kind, split into journal photos, animal photos and
 *  every other document. */
function vaultParts(rows: { kind: string; bytes: number }[]): Parts {
  const parts = { ...NO_PARTS };
  for (const r of rows) {
    if (r.kind === 'journal-photo') parts.journalPhotoBytes += r.bytes;
    else if (r.kind === 'animal-photo') parts.animalPhotoBytes += r.bytes;
    else parts.documentBytes += r.bytes;
  }
  return parts;
}

function addParts(a: Parts, b: Parts): Parts {
  return {
    journalPhotoBytes: a.journalPhotoBytes + b.journalPhotoBytes,
    animalPhotoBytes: a.animalPhotoBytes + b.animalPhotoBytes,
    documentBytes: a.documentBytes + b.documentBytes
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
      typeof v.documentBytes !== 'number' ||
      typeof v.computedAt !== 'number'
    ) {
      return null;
    }
    return {
      bytes: v.bytes,
      journalPhotoBytes: v.journalPhotoBytes,
      animalPhotoBytes: v.animalPhotoBytes,
      documentBytes: v.documentBytes,
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
  const vault = vaultParts(
    db
      .select({ kind: documents.kind, bytes: sql<number>`coalesce(sum(${documents.byteSize}), 0)` })
      .from(documents)
      .where(withTenant(documents, isNull(documents.deletedAt)))
      .groupBy(documents.kind)
      .all()
      .map((r) => ({ kind: r.kind, bytes: Number(r.bytes) }))
  );
  const inline: Parts = {
    journalPhotoBytes: Number(row?.bytes ?? 0),
    animalPhotoBytes: Number(animalRow?.bytes ?? 0),
    documentBytes: 0
  };
  return usageFrom(addParts(inline, vault), now);
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
  const vaultRows = new Map<string, { kind: string; bytes: number }[]>();
  for (const r of db
    .select({
      ownerId: documents.ownerId,
      kind: documents.kind,
      bytes: sql<number>`coalesce(sum(${documents.byteSize}), 0)`
    })
    .from(documents)
    .where(isNull(documents.deletedAt))
    .groupBy(documents.ownerId, documents.kind)
    .all()) {
    const list = vaultRows.get(r.ownerId) ?? [];
    list.push({ kind: r.kind, bytes: Number(r.bytes) });
    vaultRows.set(r.ownerId, list);
  }
  const ownerIds = db
    .select({ id: owners.id })
    .from(owners)
    .all()
    .map((r) => r.id);
  for (const ownerId of ownerIds) {
    const inline: Parts = {
      journalPhotoBytes: sums.get(ownerId) ?? 0,
      animalPhotoBytes: animalSums.get(ownerId) ?? 0,
      documentBytes: 0
    };
    const usage = usageFrom(addParts(inline, vaultParts(vaultRows.get(ownerId) ?? [])), now);
    runWithTenant(ownerId, () => setSetting(STORAGE_SETTING_KEY, JSON.stringify(usage)));
  }
  return ownerIds.length;
}
