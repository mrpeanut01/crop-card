// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';

const m = vi.hoisted(() => ({ role: 'owner' as string }));

vi.mock('$lib/server/auth', () => {
  const user = () => ({ id: 'vault-photo-user', role: m.role });
  return {
    currentUser: user,
    requireUser: user,
    requireMutator: () => {
      if (m.role === 'inspector') throw error(403, 'inspector role is read-only');
      return user();
    },
    requireOwner: () => {
      if (m.role !== 'owner') throw error(403, 'owner role required');
      return user();
    }
  };
});

vi.mock('$lib/server/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/registry')>();
  const species: Record<string, object> = {
    dog: { pluginId: 'dog', displayName: 'Dog', foodProducingDefault: false }
  };
  return {
    ...actual,
    getDataKinds: async () => ({
      species: { get: (id: string) => species[id] },
      animalHealth: { get: () => undefined }
    })
  };
});

import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { animals, documents, owners, plantingJournal, users } from '$lib/db/schema';
import { runWithTenantAsync, unscopedQueryNote } from '$lib/db/tenant';
import { createField } from '$lib/db/fields';
import { createBlock } from '$lib/db/blocks';
import { createPlanned } from '$lib/db/crops';
import { getDocument } from '$lib/db/documents';
import { EXIF_SECRET, fakeJpeg, toDataUrl } from '$lib/journal/jpegFixture';
import { sanitizePhotoDataUrl } from '$lib/journal/photo';
import type { JournalEntry } from '$lib/journal/model';
import { refreshStorageUsage } from '$lib/server/storageUsage';
import { POST as JOURNAL_POST } from '../../../routes/api/plantings/[id]/journal/+server';
import { DELETE as JOURNAL_DELETE } from '../../../routes/api/plantings/[id]/journal/[entryId]/+server';
import { GET as JOURNAL_PHOTO } from '../../../routes/api/plantings/[id]/journal/[entryId]/photo/+server';
import { POST as CREATE_ANIMAL } from '../../../routes/api/animals/+server';
import {
  DELETE as ANIMAL_DELETE,
  PATCH as ANIMAL_PATCH
} from '../../../routes/api/animals/[id]/+server';
import { GET as ANIMAL_PHOTO } from '../../../routes/api/animals/[id]/photo/+server';
import { storePhoto } from './photoWrite';
import { _setVaultStoreForTests, vaultStore, type VaultStore } from './store';
import { useTestVault } from './testing';

unscopedQueryNote('test asserts read rows directly by id after route calls');

const USER = 'vault-photo-user';

function seedOwner(): string {
  const id = `vault-photo-${randomUUID()}`;
  db.insert(owners).values({ id, name: id, slug: id, billingStatus: 'active' }).run();
  db.insert(users)
    .values({ id: USER, email: 'vault-photo@test.local' })
    .onConflictDoNothing()
    .run();
  return id;
}

function seedPlanting() {
  const area = createField({ name: 'Kitchen Garden', kind: 'garden', widthFt: 20, lengthFt: 30 });
  const bed = createBlock({
    name: 'Bed 1',
    fieldId: area.id,
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8
  });
  return createPlanned({
    blockId: bed.id,
    cropPluginId: 'tomato-amish-paste',
    varietyDisplayName: 'Amish Paste tomato'
  });
}

function jsonReq(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

type Handler = (event: never) => Response | Promise<Response>;

async function call(
  handler: unknown,
  params: Record<string, string>,
  method = 'GET',
  body?: unknown
) {
  const url = 'http://localhost/api/x';
  try {
    return await (handler as Handler)({
      params,
      url: new URL(url),
      request: jsonReq(url, method, body),
      locals: {}
    } as never);
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (!status) throw e;
    return new Response(null, { status });
  }
}

const photoUrl = toDataUrl(fakeJpeg({ exif: true, padding: 400 }));
const cleanBytes = () => {
  const s = sanitizePhotoDataUrl(photoUrl);
  if (!s.ok) throw new Error('fixture');
  return Buffer.from(s.dataUrl.split(',')[1], 'base64');
};

async function addJournalPhoto(cropId: string): Promise<JournalEntry> {
  const res = await call(JOURNAL_POST, { id: cropId }, 'POST', {
    kind: 'observation',
    text: 'Spots on leaves',
    photo: photoUrl
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { entry: JournalEntry }).entry;
}

function journalRow(id: string) {
  return db.select().from(plantingJournal).where(eq(plantingJournal.id, id)).get()!;
}

function docRow(id: string) {
  return db.select().from(documents).where(eq(documents.id, id)).get();
}

async function vaultFiles(dir: string, ownerId: string): Promise<string[]> {
  try {
    return await readdir(path.join(dir, 'owners', ownerId));
  } catch {
    return [];
  }
}

beforeEach(() => {
  m.role = 'owner';
});

describe('journal photos with the vault on', () => {
  let vault: ReturnType<typeof useTestVault>;
  beforeEach(() => {
    vault = useTestVault();
  });
  afterEach(async () => {
    await vault.cleanup();
  });

  it('stores the photo as a document and serves the same bytes from the old URL', async () => {
    const owner = seedOwner();
    await runWithTenantAsync(owner, async () => {
      const crop = seedPlanting();
      const entry = await addJournalPhoto(crop.id);
      expect(entry.hasPhoto).toBe(true);
      expect(entry.photoDocumentId).toBeTruthy();

      const row = journalRow(entry.id);
      expect(row.photoRef).toBeNull();
      const doc = getDocument(row.photoDocumentId!)!;
      expect(doc).toMatchObject({
        kind: 'journal-photo',
        title: 'Journal photo',
        mime: 'image/jpeg',
        uploadedBy: USER
      });

      const img = await call(JOURNAL_PHOTO, { id: crop.id, entryId: entry.id });
      expect(img.status).toBe(200);
      expect(img.headers.get('content-type')).toBe('image/jpeg');
      expect(img.headers.get('cache-control')).toBe('private, max-age=86400');
      expect(img.headers.get('x-content-type-options')).toBe('nosniff');
      const served = Buffer.from(await img.arrayBuffer());
      expect(served.equals(cleanBytes())).toBe(true);
      expect(served.toString('latin1')).not.toContain(EXIF_SECRET);
      expect(doc.byteSize).toBe(served.length);

      const usage = refreshStorageUsage();
      expect(usage.journalPhotoBytes).toBe(served.length);
      expect(usage.documentBytes).toBe(0);
      expect(usage.bytes).toBe(served.length);
    });
  });

  it('deleting the entry deletes its document and its file', async () => {
    const owner = seedOwner();
    await runWithTenantAsync(owner, async () => {
      const crop = seedPlanting();
      const entry = await addJournalPhoto(crop.id);
      expect(await vaultFiles(vault.dir, owner)).toHaveLength(1);
      const res = await call(JOURNAL_DELETE, { id: crop.id, entryId: entry.id }, 'DELETE');
      expect(res.status).toBe(200);
      const doc = docRow(entry.photoDocumentId!)!;
      expect(doc.deletedAt).not.toBeNull();
      expect(doc.deletedBy).toBe(USER);
      expect(await vaultFiles(vault.dir, owner)).toHaveLength(0);
    });
  });

  it('a photo document read while the vault is off answers 503 VAULT_OFF', async () => {
    const owner = seedOwner();
    await runWithTenantAsync(owner, async () => {
      const crop = seedPlanting();
      const entry = await addJournalPhoto(crop.id);
      _setVaultStoreForTests(null);
      const img = await call(JOURNAL_PHOTO, { id: crop.id, entryId: entry.id });
      expect(img.status).toBe(503);
      expect(await img.json()).toMatchObject({ code: 'VAULT_OFF' });
    });
  });

  it('a photo whose file is gone is a 404, not a crash', async () => {
    const owner = seedOwner();
    await runWithTenantAsync(owner, async () => {
      const crop = seedPlanting();
      const entry = await addJournalPhoto(crop.id);
      await vaultStore()!.delete(docRow(entry.photoDocumentId!)!.storageKey);
      expect((await call(JOURNAL_PHOTO, { id: crop.id, entryId: entry.id })).status).toBe(404);
    });
  });

  it('falls back to inline when the store fails, so the photo is never lost', async () => {
    const owner = seedOwner();
    const real = vaultStore()!;
    const failing: VaultStore = {
      ...real,
      backend: real.backend,
      put: async () => {
        throw new Error('disk full');
      }
    };
    _setVaultStoreForTests(failing);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runWithTenantAsync(owner, async () => {
      const crop = seedPlanting();
      const entry = await addJournalPhoto(crop.id);
      const row = journalRow(entry.id);
      expect(row.photoDocumentId).toBeNull();
      expect(row.photoRef).toMatch(/^data:image\/jpeg;base64,/);
      _setVaultStoreForTests(real);
      const img = await call(JOURNAL_PHOTO, { id: crop.id, entryId: entry.id });
      expect(Buffer.from(await img.arrayBuffer()).equals(cleanBytes())).toBe(true);
    });
    warn.mockRestore();
  });

  it('photos are never refused by the storage cap', async () => {
    const owner = seedOwner();
    await runWithTenantAsync(owner, async () => {
      db.insert(documents)
        .values({
          id: randomUUID(),
          ownerId: owner,
          kind: 'lab-report',
          title: 'Huge',
          mime: 'application/pdf',
          byteSize: 50_000_000_000,
          sha256: '0'.repeat(64),
          crc32: 0,
          storageKey: `owners/${owner}/${randomUUID()}`
        })
        .run();
      const stored = await storePhoto('journal-photo', photoUrl, {
        title: 'Journal photo',
        uploadedBy: null
      });
      expect('documentId' in stored).toBe(true);
    });
  });
});

describe('journal photos with the vault off', () => {
  it('stores the photo inline exactly as before', async () => {
    _setVaultStoreForTests(null);
    try {
      const owner = seedOwner();
      await runWithTenantAsync(owner, async () => {
        const crop = seedPlanting();
        const entry = await addJournalPhoto(crop.id);
        const row = journalRow(entry.id);
        expect(row.photoDocumentId).toBeNull();
        expect(row.photoRef).toBe(toDataUrl(cleanBytes()));
        const img = await call(JOURNAL_PHOTO, { id: crop.id, entryId: entry.id });
        expect(Buffer.from(await img.arrayBuffer()).equals(cleanBytes())).toBe(true);
      });
    } finally {
      _setVaultStoreForTests(undefined);
    }
  });
});

describe('animal photos with the vault on', () => {
  let vault: ReturnType<typeof useTestVault>;
  beforeEach(() => {
    vault = useTestVault();
  });
  afterEach(async () => {
    await vault.cleanup();
  });

  async function createDog(name: string | null, tag?: string): Promise<string> {
    const res = await call(CREATE_ANIMAL, {}, 'POST', {
      speciesId: 'dog',
      name,
      ...(tag ? { tag } : {})
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { animal: { id: string } }).animal.id;
  }

  it('a helper adds a photo; replacing it retires the old document; removing clears it', async () => {
    const owner = seedOwner();
    await runWithTenantAsync(owner, async () => {
      const id = await createDog('Rex');
      m.role = 'helper';
      const first = await call(ANIMAL_PATCH, { id }, 'PATCH', { photo: photoUrl });
      expect(first.status).toBe(200);
      expect(((await first.json()) as { animal: { hasPhoto: boolean } }).animal.hasPhoto).toBe(
        true
      );
      const row1 = db.select().from(animals).where(eq(animals.id, id)).get()!;
      expect(row1.photoRef).toBeNull();
      const doc1 = getDocument(row1.photoDocumentId!)!;
      expect(doc1).toMatchObject({ kind: 'animal-photo', title: 'Photo of Rex', uploadedBy: USER });

      const img = await call(ANIMAL_PHOTO, { id });
      expect(img.headers.get('content-type')).toBe('image/jpeg');
      expect(Buffer.from(await img.arrayBuffer()).equals(cleanBytes())).toBe(true);

      const second = await call(ANIMAL_PATCH, { id }, 'PATCH', {
        photo: toDataUrl(fakeJpeg({ padding: 50 }))
      });
      expect(second.status).toBe(200);
      const row2 = db.select().from(animals).where(eq(animals.id, id)).get()!;
      expect(row2.photoDocumentId).not.toBe(doc1.id);
      expect(docRow(doc1.id)!.deletedAt).not.toBeNull();
      expect(docRow(doc1.id)!.deletedBy).toBe(USER);
      expect(await vaultFiles(vault.dir, owner)).toHaveLength(1);

      const removed = await call(ANIMAL_PATCH, { id }, 'PATCH', { photo: null });
      expect(removed.status).toBe(200);
      const row3 = db.select().from(animals).where(eq(animals.id, id)).get()!;
      expect(row3.photoDocumentId).toBeNull();
      expect(row3.photoRef).toBeNull();
      expect(docRow(row2.photoDocumentId!)!.deletedAt).not.toBeNull();
      expect(await vaultFiles(vault.dir, owner)).toHaveLength(0);
      expect((await call(ANIMAL_PHOTO, { id })).status).toBe(404);
    });
  });

  it('names the document by tag when the animal has no name', async () => {
    const owner = seedOwner();
    await runWithTenantAsync(owner, async () => {
      const id = await createDog(null, '42');
      await call(ANIMAL_PATCH, { id }, 'PATCH', { photo: photoUrl });
      const row = db.select().from(animals).where(eq(animals.id, id)).get()!;
      expect(getDocument(row.photoDocumentId!)!.title).toBe('Photo of tag 42');
    });
  });

  it('deleting a mistaken animal deletes its photo document', async () => {
    const owner = seedOwner();
    await runWithTenantAsync(owner, async () => {
      const id = await createDog('Pip');
      await call(ANIMAL_PATCH, { id }, 'PATCH', { photo: photoUrl });
      const docId = db.select().from(animals).where(eq(animals.id, id)).get()!.photoDocumentId!;
      expect((await call(ANIMAL_DELETE, { id }, 'DELETE')).status).toBe(200);
      expect(docRow(docId)!.deletedAt).not.toBeNull();
      expect(await vaultFiles(vault.dir, owner)).toHaveLength(0);
    });
  });

  it('another Owner cannot read the photo through either route', async () => {
    const owner = seedOwner();
    const other = seedOwner();
    let ids: { animalId: string; cropId: string; entryId: string } = {
      animalId: '',
      cropId: '',
      entryId: ''
    };
    await runWithTenantAsync(owner, async () => {
      const animalId = await createDog('Rex');
      await call(ANIMAL_PATCH, { id: animalId }, 'PATCH', { photo: photoUrl });
      const crop = seedPlanting();
      const entry = await addJournalPhoto(crop.id);
      ids = { animalId, cropId: crop.id, entryId: entry.id };
    });
    await runWithTenantAsync(other, async () => {
      expect((await call(ANIMAL_PHOTO, { id: ids.animalId })).status).toBe(404);
      expect((await call(JOURNAL_PHOTO, { id: ids.cropId, entryId: ids.entryId })).status).toBe(
        404
      );
    });
  });
});
