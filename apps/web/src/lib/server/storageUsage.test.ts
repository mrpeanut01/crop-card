import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { db, sqliteHandle } from '$lib/db/client';
import { owners } from '$lib/db/schema';
import { runWithTenant } from '$lib/db/tenant';
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
});
