import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db, sqliteHandle } from '$lib/db/client';
import { documents, owners } from '$lib/db/schema';
import { runWithTenant, unscopedQueryNote } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { deleteJournalEntry, insertJournalEntry } from '$lib/db/plantingJournal';
import { getSetting } from '$lib/db/settings';
import { runDbMaintenance } from './dbMaintenance';
import { listAllOwners, yyyymm } from './superadmin';
import {
  STORAGE_SETTING_KEY,
  computeStorageUsage,
  recomputeAllStorageUsage,
  storageUsage
} from './storageUsage';

unscopedQueryNote('test fixtures write vault rows for one seeded Owner');

function seedOwner(): string {
  const id = `storage-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  return id;
}

function addPhoto(ownerId: string, bytes: number) {
  return runWithTenant(ownerId, () => {
    const area = createField({ name: `Garden ${randomUUID()}`, kind: 'garden' });
    const bed = createBlock({ name: 'Bed', fieldId: area.id, kind: 'bed' });
    const crop = createPlanned({
      blockId: bed.id,
      cropPluginId: 'tomato-amish-paste',
      varietyDisplayName: 'Amish Paste tomato'
    });
    const entry = insertJournalEntry({
      cropId: crop.id,
      blockId: bed.id,
      createdBy: null,
      kind: 'observation',
      text: 'Leaves look spotty',
      photoRef: 'x'.repeat(bytes),
      provenance: 'manual'
    });
    insertJournalEntry({
      cropId: crop.id,
      blockId: bed.id,
      createdBy: null,
      kind: 'note',
      text: 'no photo',
      provenance: 'manual'
    });
    return { cropId: crop.id, entryId: entry.id };
  });
}

describe('storage computed from source', () => {
  it('sums only the active Owner photo bytes', () => {
    const a = seedOwner();
    const b = seedOwner();
    addPhoto(a, 1200);
    addPhoto(a, 300);
    addPhoto(b, 5000);
    expect(runWithTenant(a, () => computeStorageUsage().bytes)).toBe(1500);
    expect(runWithTenant(b, () => computeStorageUsage().journalPhotoBytes)).toBe(5000);
    expect(runWithTenant(seedOwner(), () => computeStorageUsage().bytes)).toBe(0);
  });

  it('caches the total and only moves it on a recompute', () => {
    const a = seedOwner();
    const first = addPhoto(a, 800);
    expect(runWithTenant(a, () => storageUsage(1000))).toMatchObject({
      bytes: 800,
      computedAt: 1000
    });
    runWithTenant(a, () => deleteJournalEntry(first.cropId, first.entryId));
    expect(runWithTenant(a, () => storageUsage(2000).bytes)).toBe(800);

    const written = recomputeAllStorageUsage(3000);
    expect(written).toBeGreaterThanOrEqual(1);
    expect(runWithTenant(a, () => storageUsage(4000))).toMatchObject({
      bytes: 0,
      computedAt: 3000
    });
  });

  it('a malformed cache value is recomputed', () => {
    const a = seedOwner();
    addPhoto(a, 64);
    sqliteHandle()
      .prepare('INSERT INTO app_settings (owner_id, key, value, updated_at) VALUES (?, ?, ?, ?)')
      .run(a, STORAGE_SETTING_KEY, '{not json', Date.now());
    expect(runWithTenant(a, () => storageUsage().bytes)).toBe(64);
  });

  it('the nightly maintenance pass recomputes every Owner', async () => {
    const a = seedOwner();
    addPhoto(a, 2048);
    const res = await runDbMaintenance({ now: Date.UTC(2001, 5, 1), force: true });
    expect(res.storageOwners).toBeGreaterThanOrEqual(1);
    const cached = JSON.parse(runWithTenant(a, () => getSetting(STORAGE_SETTING_KEY)) ?? '{}');
    expect(cached).toMatchObject({ bytes: 2048, journalPhotoBytes: 2048 });
  });

  it('the admin list reads the computed total, not owner_usage_counters', () => {
    const a = seedOwner();
    addPhoto(a, 4096);
    sqliteHandle()
      .prepare(
        'INSERT INTO owner_usage_counters (owner_id, period_yyyymm, ai_calls, spray_events_count, storage_bytes, updated_at) VALUES (?, ?, 0, 0, ?, ?)'
      )
      .run(a, yyyymm(Date.now()), 999_999_999, Date.now());
    const row = listAllOwners().find((o) => o.id === a);
    expect(row?.storageBytes).toBe(4096);
  });

  it('a cached total from before the vault (no documentBytes) is recomputed', () => {
    const a = seedOwner();
    addPhoto(a, 100);
    sqliteHandle()
      .prepare('INSERT INTO app_settings (owner_id, key, value, updated_at) VALUES (?, ?, ?, ?)')
      .run(
        a,
        STORAGE_SETTING_KEY,
        JSON.stringify({ bytes: 5, journalPhotoBytes: 5, animalPhotoBytes: 0, computedAt: 1 }),
        Date.now()
      );
    expect(runWithTenant(a, () => storageUsage())).toMatchObject({
      bytes: 100,
      documentBytes: 0
    });
  });

  it('adds vault photos to their bucket and other live files to documentBytes', () => {
    const a = seedOwner();
    addPhoto(a, 40);
    const doc = (kind: string, byteSize: number, deleted = false) =>
      db
        .insert(documents)
        .values({
          id: randomUUID(),
          ownerId: a,
          kind: kind as 'other',
          title: kind,
          mime: 'image/jpeg',
          byteSize,
          sha256: '0'.repeat(64),
          crc32: 0,
          storageKey: `owners/${a}/${randomUUID()}`,
          deletedAt: deleted ? new Date() : null
        })
        .run();
    doc('journal-photo', 1000);
    doc('animal-photo', 300);
    doc('lab-report', 7000);
    doc('certificate', 9, true);
    const usage = runWithTenant(a, () => computeStorageUsage());
    expect(usage).toMatchObject({
      journalPhotoBytes: 1040,
      animalPhotoBytes: 300,
      documentBytes: 7000,
      bytes: 8340
    });
    recomputeAllStorageUsage(5000);
    expect(runWithTenant(a, () => storageUsage())).toMatchObject({
      journalPhotoBytes: 1040,
      animalPhotoBytes: 300,
      documentBytes: 7000,
      bytes: 8340,
      computedAt: 5000
    });
  });
});
