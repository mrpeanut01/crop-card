// @vitest-environment node
/**
 * The photo migration, the unreferenced-photo sweep, the wipe queue and the
 * orphan sweep walk every farm; like every test file this one runs on its
 * own database clone (tests/vitestSetup.ts), so it never moves or deletes
 * another test file's rows.
 */
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { readdir, utimes } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DB_FILE = process.env.DATABASE_URL!.replace(/^file:/, '');

import { eq } from 'drizzle-orm';
import { db, sqliteHandle } from '$lib/db/client';
import { animals, blobDeletions, documents, owners, plantingJournal, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync, unscopedQueryNote } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { insertJournalEntry } from '$lib/db/plantingJournal';
import { getAnimal, insertAnimal } from '$lib/db/animals';
import { wipeAllData } from '$lib/db/admin';
import { getSetting } from '$lib/db/settings';
import { _fenceForTests, _resetHandoffForTests } from '$lib/server/ops/handoff';
import { runDbMaintenance } from '$lib/server/dbMaintenance';
import { STORAGE_SETTING_KEY } from '$lib/server/storageUsage';
import { exifJpeg, hasBytes, plainJpeg, cat } from './__fixtures__/files';
import { drainBlobDeletions, sweepOrphans } from './blobQueue';
import { migrateInlinePhotos, retireUnreferencedPhotos } from './photoMigration';
import { photoResponse, storePhoto } from './photoWrite';
import { _setVaultStoreForTests, vaultStore, type VaultStore } from './store';
import { useTestVault } from './testing';

unscopedQueryNote('this file checks deployment-wide vault jobs on its own database');

const DAY = 86_400_000;
const HEADER = 'data:image/jpeg;base64,';
const toUrl = (b: Uint8Array) => HEADER + Buffer.from(b).toString('base64');

/** A plain JPEG with `n` bytes of entropy data, no metadata. */
function bigJpeg(n: number, seed = 1): Uint8Array {
  const plain = plainJpeg();
  const fill = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    fill[i] = x % 0xfe;
  }
  return cat(plain.subarray(0, plain.length - 2), fill, [0xff, 0xd9]);
}

let vault: ReturnType<typeof useTestVault>;
beforeEach(() => {
  vault = useTestVault();
  _resetHandoffForTests();
});
afterEach(async () => {
  _resetHandoffForTests();
  await vault.cleanup();
  vi.restoreAllMocks();
});

function seedOwner(): string {
  const id = `mig-${randomUUID().slice(0, 12)}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users).values({ id: 'mig-user', email: 'mig@test.local' }).onConflictDoNothing().run();
  return id;
}

function seedCrop(ownerId: string): { cropId: string; blockId: string } {
  return runWithTenant(ownerId, () => {
    const area = createField({ name: `Garden ${randomUUID()}`, kind: 'garden' });
    const bed = createBlock({ name: 'Bed', fieldId: area.id, kind: 'bed' });
    const crop = createPlanned({
      blockId: bed.id,
      cropPluginId: 'tomato-amish-paste',
      varietyDisplayName: 'Amish Paste tomato'
    });
    return { cropId: crop.id, blockId: bed.id };
  });
}

function inlineJournal(ownerId: string, photo: string, createdAt = Date.UTC(2026, 4, 2)) {
  const { cropId, blockId } = seedCrop(ownerId);
  return runWithTenant(ownerId, () =>
    insertJournalEntry({
      cropId,
      blockId,
      createdBy: 'mig-user',
      kind: 'observation',
      text: 'Spots',
      photoRef: photo,
      provenance: 'manual',
      createdAt
    })
  );
}

function inlineAnimal(ownerId: string, photo: string, name: string | null, tag?: string) {
  return runWithTenant(ownerId, () => {
    const a = insertAnimal({
      speciesId: 'dog',
      name,
      tag: tag ?? null,
      purpose: 'pet',
      foodProducing: false
    });
    db.update(animals).set({ photoRef: photo }).where(eq(animals.id, a.id)).run();
    return a;
  });
}

const journalRow = (id: string) =>
  db.select().from(plantingJournal).where(eq(plantingJournal.id, id)).get()!;
const animalRow = (id: string) => db.select().from(animals).where(eq(animals.id, id)).get()!;
const docRow = (id: string) => db.select().from(documents).where(eq(documents.id, id)).get()!;

async function fileCount(ownerId: string): Promise<number> {
  try {
    return (await readdir(path.join(vault.dir, 'owners', ownerId))).length;
  } catch {
    return 0;
  }
}

async function served(ref: { documentId: string } | { inline: string }): Promise<Buffer> {
  return Buffer.from(await (await photoResponse(ref)).arrayBuffer());
}

describe('migrateInlinePhotos', () => {
  it('moves journal and animal photos byte for byte and clears the inline column', async () => {
    const owner = seedOwner();
    const jpeg = bigJpeg(2000);
    const entry = inlineJournal(owner, toUrl(jpeg));
    const rex = inlineAnimal(owner, toUrl(jpeg), 'Rex');
    const tagged = inlineAnimal(owner, toUrl(plainJpeg()), null, 'B-7');

    const now = Date.UTC(2026, 9, 1, 12);
    const res = await migrateInlinePhotos({ now });
    expect(res.moved).toBeGreaterThanOrEqual(3);
    expect(res.remaining).toBe(0);

    const j = journalRow(entry.id);
    expect(j.photoRef).toBeNull();
    const jDoc = docRow(j.photoDocumentId!);
    expect(jDoc).toMatchObject({
      ownerId: owner,
      kind: 'journal-photo',
      title: 'Journal photo',
      mime: 'image/jpeg',
      uploadedBy: 'mig-user',
      byteSize: jpeg.length
    });
    expect(jDoc.createdAt.getTime()).toBe(Date.UTC(2026, 4, 2));
    const bytes = await runWithTenantAsync(owner, () => served({ documentId: j.photoDocumentId! }));
    expect(bytes.equals(Buffer.from(jpeg))).toBe(true);

    const a = animalRow(rex.id);
    expect(a.photoRef).toBeNull();
    expect(docRow(a.photoDocumentId!)).toMatchObject({
      kind: 'animal-photo',
      title: 'Photo of Rex',
      uploadedBy: null
    });
    expect(docRow(a.photoDocumentId!).createdAt.getTime()).toBe(now);
    expect(docRow(animalRow(tagged.id).photoDocumentId!).title).toBe('Photo of tag B-7');
    expect(runWithTenant(owner, () => getAnimal(rex.id)!.hasPhoto)).toBe(true);
    expect(await fileCount(owner)).toBe(3);
  });

  it('strips EXIF, including GPS, from a photo that carried it', async () => {
    const owner = seedOwner();
    const entry = inlineJournal(owner, toUrl(exifJpeg(1)));
    await migrateInlinePhotos();
    const docId = journalRow(entry.id).photoDocumentId!;
    const bytes = await runWithTenantAsync(owner, () => served({ documentId: docId }));
    expect(hasBytes(bytes, 'GPSMARK')).toBe(false);
    expect(hasBytes(bytes, 'XMPMARK')).toBe(false);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  it('leaves a row whose data URL is not a JPEG inline and counts it', async () => {
    const owner = seedOwner();
    const bad = inlineJournal(owner, 'data:image/jpeg;base64,bm90IGEganBlZw==');
    const png = inlineAnimal(owner, 'data:image/png;base64,iVBORw0KGgo=', 'Odd');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await migrateInlinePhotos();
    expect(res.skipped).toBeGreaterThanOrEqual(2);
    expect(journalRow(bad.id).photoRef).toMatch(/^data:image\/jpeg/);
    expect(journalRow(bad.id).photoDocumentId).toBeNull();
    expect(animalRow(png.id).photoRef).toMatch(/^data:image\/png/);
    expect(res.remaining).toBeGreaterThanOrEqual(2);
    expect(log.mock.calls.some((c) => String(c[0]).includes('[vault] photo migration'))).toBe(true);
    db.update(plantingJournal).set({ photoRef: null }).where(eq(plantingJournal.id, bad.id)).run();
    db.update(animals).set({ photoRef: null }).where(eq(animals.id, png.id)).run();
  });

  it('never overwrites a photo changed during the move, and leaves no document behind', async () => {
    const owner = seedOwner();
    const entry = inlineJournal(owner, toUrl(bigJpeg(500, 3)));
    const replacement = toUrl(bigJpeg(600, 4));
    const real = vaultStore()!;
    const racing: VaultStore = {
      ...real,
      backend: real.backend,
      async put(key, body, opts) {
        const out = await real.put(key, body, opts);
        db.update(plantingJournal)
          .set({ photoRef: replacement })
          .where(eq(plantingJournal.id, entry.id))
          .run();
        return out;
      }
    };
    _setVaultStoreForTests(racing);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await migrateInlinePhotos();
    expect(res.moved).toBe(0);
    const row = journalRow(entry.id);
    expect(row.photoRef).toBe(replacement);
    expect(row.photoDocumentId).toBeNull();
    expect(db.select().from(documents).where(eq(documents.ownerId, owner)).all()).toEqual([]);
    expect(await fileCount(owner)).toBe(0);

    _setVaultStoreForTests(real);
    const again = await migrateInlinePhotos();
    expect(again.moved).toBeGreaterThanOrEqual(1);
    const bytes = await runWithTenantAsync(owner, () =>
      served({ documentId: journalRow(entry.id).photoDocumentId! })
    );
    expect(bytes.equals(Buffer.from(bigJpeg(600, 4)))).toBe(true);
  });

  it('works in batches and stops on the budget, the fence or a vault failure', async () => {
    const owner = seedOwner();
    for (let i = 0; i < 5; i++) inlineJournal(owner, toUrl(bigJpeg(100, i + 10)));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const none = await migrateInlinePhotos({ budgetMs: 0 });
    expect(none).toEqual({ moved: 0, skipped: 0, remaining: 5 });

    _fenceForTests('deploy');
    expect((await migrateInlinePhotos()).moved).toBe(0);
    _resetHandoffForTests();

    const real = vaultStore()!;
    _setVaultStoreForTests({
      ...real,
      backend: real.backend,
      put: async () => {
        throw new Error('blob outage');
      }
    });
    const failed = await migrateInlinePhotos();
    expect(failed.moved).toBe(0);
    expect(failed.remaining).toBe(5);
    _setVaultStoreForTests(real);

    const done = await migrateInlinePhotos({ batchSize: 2 });
    expect(done).toEqual({ moved: 5, skipped: 0, remaining: 0 });
  });

  it('does nothing with the vault off', async () => {
    const owner = seedOwner();
    const entry = inlineJournal(owner, toUrl(plainJpeg()));
    _setVaultStoreForTests(null);
    const res = await migrateInlinePhotos();
    expect(res.moved).toBe(0);
    expect(res.remaining).toBeGreaterThanOrEqual(1);
    expect(journalRow(entry.id).photoDocumentId).toBeNull();
    db.update(plantingJournal)
      .set({ photoRef: null })
      .where(eq(plantingJournal.id, entry.id))
      .run();
  });

  it('frees database pages, and VACUUM then shrinks the file', async () => {
    const owner = seedOwner();
    for (let i = 0; i < 40; i++) inlineJournal(owner, toUrl(bigJpeg(60_000, 100 + i)));
    const sqlite = sqliteHandle();
    const used = () =>
      Number(sqlite.pragma('page_count', { simple: true })) -
      Number(sqlite.pragma('freelist_count', { simple: true }));
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    const before = used();
    const sizeBefore = statSync(DB_FILE).size;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await migrateInlinePhotos();
    expect(res.moved).toBe(40);
    const after = used();
    expect(after).toBeLessThan(before);
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    sqlite.exec('VACUUM');
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    expect(statSync(DB_FILE).size).toBeLessThan(sizeBefore);
  });
});

describe('retireUnreferencedPhotos', () => {
  it('retires a photo document no row points at once it is a day old', async () => {
    const owner = seedOwner();
    const { cropId, blockId } = seedCrop(owner);
    const t0 = Date.UTC(2026, 8, 1);
    const stored = await runWithTenantAsync(owner, () =>
      storePhoto('journal-photo', toUrl(plainJpeg()), { title: 'Journal photo', uploadedBy: null })
    );
    if (!('documentId' in stored)) throw new Error('expected a document');
    const kept = await runWithTenantAsync(owner, () =>
      storePhoto('journal-photo', toUrl(bigJpeg(10)), { title: 'Journal photo', uploadedBy: null })
    );
    if (!('documentId' in kept)) throw new Error('expected a document');
    runWithTenant(owner, () =>
      insertJournalEntry({
        cropId,
        blockId,
        createdBy: null,
        kind: 'note',
        text: 'kept',
        photoDocumentId: kept.documentId,
        provenance: 'manual'
      })
    );
    db.update(documents)
      .set({ createdAt: new Date(t0) })
      .where(eq(documents.ownerId, owner))
      .run();

    expect(await retireUnreferencedPhotos(t0 + DAY - 1)).toBe(0);
    expect(await retireUnreferencedPhotos(t0 + DAY + 1)).toBe(1);
    const gone = docRow(stored.documentId);
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.deletedBy).toBeNull();
    expect(docRow(kept.documentId).deletedAt).toBeNull();
    expect(await fileCount(owner)).toBe(1);
  });

  it('catches photos whose planting was deleted in SQL', async () => {
    const owner = seedOwner();
    const entry = inlineJournal(owner, toUrl(plainJpeg()));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await migrateInlinePhotos();
    const docId = journalRow(entry.id).photoDocumentId!;
    db.delete(plantingJournal).where(eq(plantingJournal.id, entry.id)).run();
    db.update(documents)
      .set({ createdAt: new Date(Date.now() - 2 * DAY) })
      .where(eq(documents.id, docId))
      .run();
    expect(await retireUnreferencedPhotos()).toBeGreaterThanOrEqual(1);
    expect(docRow(docId).deletedAt).not.toBeNull();
    expect(await fileCount(owner)).toBe(0);
  });
});

describe('drainBlobDeletions and sweepOrphans', () => {
  async function putFile(ownerId: string, ageMs: number, now: number): Promise<string> {
    const key = `owners/${ownerId}/${randomUUID()}`;
    await vaultStore()!.put(key, plainJpeg(), { contentType: 'image/jpeg' });
    const t = new Date(now - ageMs);
    await utimes(path.join(vault.dir, key), t, t);
    return key;
  }

  it('a wipe clears the farm files, keeps one uploaded after it, then leaves the queue', async () => {
    const owner = seedOwner();
    const entry = inlineJournal(owner, toUrl(plainJpeg()));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await migrateInlinePhotos();
    expect(journalRow(entry.id).photoDocumentId).toBeTruthy();
    const now = Date.now();
    await putFile(owner, DAY * 3, now);
    const old = new Date(now - DAY);
    for (const f of await readdir(path.join(vault.dir, 'owners', owner))) {
      await utimes(path.join(vault.dir, 'owners', owner, f), old, old);
    }

    runWithTenant(owner, () => wipeAllData({}));
    const queued = db
      .select()
      .from(blobDeletions)
      .where(eq(blobDeletions.storagePrefix, `owners/${owner}/`))
      .get();
    expect(queued).toBeTruthy();
    const afterWipe = await runWithTenantAsync(owner, () =>
      storePhoto('animal-photo', toUrl(bigJpeg(30)), { title: 'Animal photo', uploadedBy: null })
    );
    if (!('documentId' in afterWipe)) throw new Error('expected a document');
    const fresh = (await readdir(path.join(vault.dir, 'owners', owner))).length;
    expect(fresh).toBe(3);
    const later = new Date(Date.now() + 60_000);
    await utimes(path.join(vault.dir, docRow(afterWipe.documentId).storageKey), later, later);

    const res = await drainBlobDeletions();
    expect(res.cleared).toBeGreaterThanOrEqual(1);
    expect(await fileCount(owner)).toBe(1);
    expect(
      db
        .select()
        .from(blobDeletions)
        .where(eq(blobDeletions.storagePrefix, `owners/${owner}/`))
        .get()
    ).toBeUndefined();
  });

  it('a failing prefix stays queued with its attempts and error, loud from the fifth try', async () => {
    const owner = seedOwner();
    db.insert(blobDeletions)
      .values({ storagePrefix: `owners/${owner}/`, requestedAt: new Date(), attempts: 4 })
      .run();
    await putFile(owner, DAY, Date.now());
    const real = vaultStore()!;
    _setVaultStoreForTests({
      ...real,
      backend: real.backend,
      list: real.list.bind(real),
      delete: async () => {
        throw new Error('403 from storage');
      }
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await drainBlobDeletions();
    expect(res.failed).toBeGreaterThanOrEqual(1);
    const row = db
      .select()
      .from(blobDeletions)
      .where(eq(blobDeletions.storagePrefix, `owners/${owner}/`))
      .get()!;
    expect(row.attempts).toBe(5);
    expect(row.lastError).toMatch(/could not be deleted/);
    expect(err.mock.calls.some((c) => String(c[0]).includes('[vault] wipe cleanup'))).toBe(true);
    _setVaultStoreForTests(real);
    expect((await drainBlobDeletions()).cleared).toBeGreaterThanOrEqual(1);
  });

  it('stops when the fence rises', async () => {
    const owner = seedOwner();
    db.insert(blobDeletions)
      .values({ storagePrefix: `owners/${owner}/`, requestedAt: new Date() })
      .run();
    await putFile(owner, DAY, Date.now());
    _fenceForTests('deploy');
    expect(await drainBlobDeletions()).toEqual({ cleared: 0, failed: 0 });
    expect(await sweepOrphans()).toEqual({ deleted: 0 });
    expect(await fileCount(owner)).toBe(1);
    _resetHandoffForTests();
    await drainBlobDeletions();
    expect(await fileCount(owner)).toBe(0);
  });

  it('the orphan sweep deletes only unreferenced files over a day old', async () => {
    const owner = seedOwner();
    const now = Date.now();
    const oldOrphan = await putFile(owner, 2 * DAY, now);
    const newOrphan = await putFile(owner, 60_000, now);
    const live = await runWithTenantAsync(owner, () =>
      storePhoto('journal-photo', toUrl(plainJpeg()), { title: 'Journal photo', uploadedBy: null })
    );
    if (!('documentId' in live)) throw new Error('expected a document');
    const liveKey = docRow(live.documentId).storageKey;
    const old = new Date(now - 3 * DAY);
    await utimes(path.join(vault.dir, liveKey), old, old);

    const res = await sweepOrphans(now);
    expect(res.deleted).toBeGreaterThanOrEqual(1);
    const left = await readdir(path.join(vault.dir, 'owners', owner));
    expect(left).not.toContain(oldOrphan.split('/')[2]);
    expect(left).toContain(newOrphan.split('/')[2]);
    expect(left).toContain(liveKey.split('/')[2]);
  });
});

describe('runDbMaintenance with the vault on', () => {
  it('moves photos before the storage recompute, so the total does not drop', async () => {
    const owner = seedOwner();
    const jpeg = bigJpeg(3000, 77);
    inlineJournal(owner, toUrl(jpeg));
    inlineAnimal(owner, toUrl(jpeg), 'Bess');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await runDbMaintenance({ force: true });
    expect(res.vault).toMatchObject({ photosRemaining: 0 });
    expect(res.vault!.photosMoved).toBeGreaterThanOrEqual(2);
    const cached = JSON.parse(runWithTenant(owner, () => getSetting(STORAGE_SETTING_KEY)) ?? '{}');
    expect(cached).toMatchObject({
      journalPhotoBytes: jpeg.length,
      animalPhotoBytes: jpeg.length,
      documentBytes: 0,
      bytes: 2 * jpeg.length
    });
  });

  it('reports nothing for the vault when it is off', async () => {
    _setVaultStoreForTests(null);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await runDbMaintenance({ force: true });
    expect(res.vault).toBeUndefined();
  });
});
