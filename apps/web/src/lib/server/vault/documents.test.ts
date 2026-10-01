// @vitest-environment node
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { runWithTenantAsync } from '$lib/db/tenant';
import { _fenceForTests, _resetHandoffForTests } from '$lib/server/ops/handoff';
import { crc32 } from '../zip';
import {
  _reservedBytesForTests,
  discardDocument,
  openDocument,
  saveDocument,
  type SaveDocumentInput
} from './documents';
import { _bindVaultRepoForTests, type VaultDocumentRow, type VaultRepoBinding } from './repo';
import { _setVaultStoreForTests, vaultStore, type VaultObject } from './store';
import { useTestVault } from './testing';
import { ascii, cat, exifJpeg, hasBytes, pdf, plainJpeg } from './__fixtures__/files';

/** In-memory stand-in for A1's documents repo, tenant-aware through the
 *  owner id the vault passes in the storage key. */
function fakeRepo(): VaultRepoBinding & { rows: VaultDocumentRow[] } {
  let rows: VaultDocumentRow[] = [];
  let currentOwner = () => 'owner_home_farm';
  const repo = {
    get rows() {
      return rows;
    },
    documentStorageKey(ownerId: string, id: string) {
      currentOwner = () => ownerId;
      return `owners/${ownerId}/${id}`;
    },
    insertDocument(input: Parameters<VaultRepoBinding['insertDocument']>[0]) {
      const ownerId = input.storageKey.split('/')[1];
      const row: VaultDocumentRow = {
        ...input,
        ownerId,
        createdAt: new Date(input.createdAt ?? Date.now()),
        deletedAt: null,
        deletedBy: null
      };
      rows.push(row);
      return row;
    },
    getDocument(id: string) {
      return rows.find((r) => r.id === id && !r.deletedAt);
    },
    markDocumentDeleted(id: string, by: string | null) {
      const r = rows.find((x) => x.id === id && !x.deletedAt);
      if (!r) return undefined;
      r.deletedAt = new Date();
      r.deletedBy = by;
      return r;
    },
    liveDocumentBytes() {
      const owner = currentOwner();
      return rows
        .filter((r) => r.ownerId === owner && !r.deletedAt)
        .reduce((n, r) => n + r.byteSize, 0);
    },
    transaction<T>(fn: () => T): T {
      const snapshot = rows.map((r) => ({ ...r }));
      try {
        return fn();
      } catch (err) {
        rows = snapshot;
        throw err;
      }
    }
  };
  return repo;
}

let vault: ReturnType<typeof useTestVault>;
let repo: ReturnType<typeof fakeRepo>;
let prevRepo: VaultRepoBinding | null;

beforeEach(() => {
  vault = useTestVault();
  repo = fakeRepo();
  prevRepo = _bindVaultRepoForTests(repo);
});
afterEach(async () => {
  _bindVaultRepoForTests(prevRepo);
  _resetHandoffForTests();
  await vault.cleanup();
});
afterAll(() => _setVaultStoreForTests(undefined));

function input(body: Uint8Array, over: Partial<SaveDocumentInput> = {}): SaveDocumentInput {
  return {
    kind: 'lab-report',
    title: 'Soil test',
    originalName: 'soil.pdf',
    uploadedBy: null,
    body,
    declaredLength: body.length,
    capBytes: 100_000_000,
    ...over
  };
}

async function storedKeys(prefix = 'owners/'): Promise<VaultObject[]> {
  const out: VaultObject[] = [];
  for await (const o of vaultStore()!.list(prefix)) out.push(o);
  return out;
}

async function bytesOf(stream: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const asOwner = <T>(ownerId: string, fn: () => Promise<T>) => runWithTenantAsync(ownerId, fn);

describe('saveDocument', () => {
  it('stores a PDF under the Owner prefix and writes a matching row', async () => {
    const body = pdf();
    const r = await asOwner('owner_a', () => saveDocument(input(body, { uploadedBy: 'user_1' })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = r.document;
    expect(doc.storageKey).toBe(`owners/owner_a/${doc.id}`);
    expect(doc).toMatchObject({
      kind: 'lab-report',
      title: 'Soil test',
      mime: 'application/pdf',
      byteSize: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
      crc32: crc32(body),
      originalName: 'soil.pdf',
      uploadedBy: 'user_1'
    });
    expect(await bytesOf(await openDocument(doc))).toEqual(body);
    expect(_reservedBytesForTests('owner_a')).toBe(0);
  });

  it('describes the stored (stripped) bytes, not the upload', async () => {
    const body = exifJpeg(1);
    const r = await asOwner('owner_a', () => saveDocument(input(body, { kind: 'photo' })));
    if (!r.ok) throw new Error(r.code);
    const stored = await bytesOf(await openDocument(r.document));
    expect(stored).toEqual(plainJpeg());
    expect(hasBytes(stored, 'GPSMARK')).toBe(false);
    expect(r.document.byteSize).toBe(stored.length);
    expect(r.document.sha256).toBe(createHash('sha256').update(stored).digest('hex'));
    expect(r.document.crc32).toBe(crc32(stored));
  });

  it('honours createdAt and the allow list', async () => {
    const at = Date.UTC(2025, 4, 1);
    const ok = await saveDocument(
      input(plainJpeg(), {
        kind: 'journal-photo',
        allow: ['image/jpeg'],
        createdAt: at,
        capBytes: null
      })
    );
    expect(ok.ok && ok.document.createdAt.getTime()).toBe(at);
    const no = await saveDocument(input(pdf(), { allow: ['image/jpeg'] }));
    expect(no).toMatchObject({ ok: false, status: 415, code: 'UNSUPPORTED_TYPE' });
  });

  it('is VAULT_OFF when no store or no repo is available', async () => {
    _setVaultStoreForTests(null);
    expect(await saveDocument(input(pdf()))).toMatchObject({
      ok: false,
      status: 503,
      code: 'VAULT_OFF',
      message: "Document storage isn't set up yet."
    });
    _setVaultStoreForTests(undefined);
    vault = useTestVault();
    _bindVaultRepoForTests(null);
    expect(await saveDocument(input(pdf()))).toMatchObject({ code: 'VAULT_OFF' });
  });

  it('is FENCED while the deploy handoff fence is up', async () => {
    _fenceForTests();
    expect(await saveDocument(input(pdf()))).toMatchObject({
      ok: false,
      status: 503,
      code: 'FENCED'
    });
    expect(await storedKeys()).toEqual([]);
  });

  it('checks Content-Length before reading the body', async () => {
    let read = false;
    const body = {
      [Symbol.asyncIterator]() {
        read = true;
        return [][Symbol.iterator]() as unknown as AsyncIterator<Uint8Array>;
      }
    };
    expect(await saveDocument(input(pdf(), { body, declaredLength: null }))).toMatchObject({
      status: 411,
      code: 'LENGTH_REQUIRED'
    });
    expect(await saveDocument(input(pdf(), { body, declaredLength: 20_000_001 }))).toMatchObject({
      status: 413,
      code: 'TOO_LARGE'
    });
    expect(await saveDocument(input(pdf(), { body, declaredLength: 0 }))).toMatchObject({
      status: 400,
      code: 'EMPTY'
    });
    expect(read).toBe(false);
    expect((await saveDocument(input(pdf(), { declaredLength: 20_000_000 }))).ok).toBe(false);
  });

  it('stores nothing for a refused type, a truncated body or a late CSV failure', async () => {
    const html = ascii('<html><body>x</body></html>');
    expect(await saveDocument(input(html))).toMatchObject({
      status: 415,
      code: 'UNSUPPORTED_TYPE'
    });
    const p = pdf();
    expect(await saveDocument(input(p, { declaredLength: p.length + 1 }))).toMatchObject({
      status: 400,
      code: 'TRUNCATED'
    });
    const lateBad = cat(ascii('a,b\n'.repeat(300_000)), [0]);
    expect(await saveDocument(input(lateBad, { kind: 'other' }))).toMatchObject({
      status: 415,
      code: 'UNSUPPORTED_TYPE'
    });
    expect(await storedKeys()).toEqual([]);
    expect(repo.rows).toEqual([]);
  });

  it('treats a client that drops mid-upload as TRUNCATED and stores nothing', async () => {
    async function* dropping() {
      yield pdf().subarray(0, 10);
      throw new Error('socket hang up');
    }
    const r = await saveDocument(input(pdf(), { body: dropping() as AsyncIterable<Uint8Array> }));
    expect(r).toMatchObject({ ok: false, status: 400, code: 'TRUNCATED' });
    expect(await storedKeys()).toEqual([]);
  });

  it('rethrows a storage failure and releases the reservation', async () => {
    const real = vaultStore()!;
    _setVaultStoreForTests({
      ...real,
      backend: 'blob',
      put: async () => {
        throw new Error('blob PUT BLOCK failed: HTTP 500');
      }
    });
    await expect(runWithTenantAsync('owner_a', () => saveDocument(input(pdf())))).rejects.toThrow(
      /HTTP 500/
    );
    expect(_reservedBytesForTests('owner_a')).toBe(0);
    expect(repo.rows).toEqual([]);
  });

  it('refuses STORAGE_FULL before reading when the cap would be crossed', async () => {
    const body = pdf();
    const first = await saveDocument(input(body, { capBytes: body.length * 2 }));
    expect(first.ok).toBe(true);
    const second = await saveDocument(input(body, { capBytes: body.length * 2 }));
    expect(second.ok).toBe(true);
    const third = await saveDocument(input(body, { capBytes: body.length * 2 }));
    expect(third).toMatchObject({
      ok: false,
      status: 413,
      code: 'STORAGE_FULL',
      message:
        "Your farm's file storage is full. Delete files or move to a bigger plan to upload more."
    });
    expect((await storedKeys()).length).toBe(2);
  });

  it('never lets parallel uploads overshoot the cap', async () => {
    const body = pdf();
    const cap = body.length * 3;
    const slow = () =>
      (async function* () {
        await new Promise((r) => setTimeout(r, 20));
        yield body;
      })();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => saveDocument(input(body, { body: slow(), capBytes: cap })))
    );
    expect(results.filter((r) => r.ok).length).toBe(3);
    expect(results.filter((r) => !r.ok && r.code === 'STORAGE_FULL').length).toBe(3);
    expect(repo.liveDocumentBytes()).toBeLessThanOrEqual(cap);
    expect((await storedKeys()).length).toBe(3);
    expect(_reservedBytesForTests('owner_home_farm')).toBe(0);
  });

  it('re-checks the cap after ingest and deletes the bytes on refusal', async () => {
    const body = pdf();
    const cap = body.length + 5;
    async function* sneaky() {
      repo.insertDocument({
        id: 'other',
        kind: 'other',
        title: 'x',
        mime: 'application/pdf',
        byteSize: 10,
        sha256: '',
        crc32: 0,
        storageKey: 'owners/owner_home_farm/other',
        originalName: null,
        uploadedBy: null
      });
      yield body;
    }
    const r = await saveDocument(input(body, { body: sneaky(), capBytes: cap }));
    expect(r).toMatchObject({ ok: false, code: 'STORAGE_FULL' });
    expect(await storedKeys()).toEqual([]);
    expect(repo.rows.map((x) => x.id)).toEqual(['other']);
  });

  it('skips the cap entirely when capBytes is null (photos)', async () => {
    const r = await saveDocument(
      input(plainJpeg(), { kind: 'animal-photo', capBytes: null, allow: ['image/jpeg'] })
    );
    expect(r.ok).toBe(true);
    const over = await saveDocument(input(pdf(), { capBytes: 1 }));
    expect(over).toMatchObject({ code: 'STORAGE_FULL' });
  });

  it('rolls back the row and deletes the bytes when inTransaction throws', async () => {
    let seen: VaultDocumentRow | null = null;
    const r = await saveDocument(
      input(pdf(), {
        inTransaction: (doc) => {
          seen = doc;
          throw new Error('photo changed meanwhile');
        }
      })
    );
    expect(seen).not.toBeNull();
    expect(r).toMatchObject({ ok: false, status: 409, code: 'ABORTED' });
    expect(repo.rows).toEqual([]);
    expect(await storedKeys()).toEqual([]);
  });

  it('keeps each Owner in its own prefix', async () => {
    const a = await asOwner('owner_a', () => saveDocument(input(pdf('AAA'))));
    const b = await asOwner('owner_b', () => saveDocument(input(pdf('BBB'))));
    if (!a.ok || !b.ok) throw new Error('save failed');
    expect(a.document.storageKey.startsWith('owners/owner_a/')).toBe(true);
    expect(b.document.storageKey.startsWith('owners/owner_b/')).toBe(true);
    expect((await storedKeys('owners/owner_a/')).map((o) => o.key)).toEqual([
      a.document.storageKey
    ]);
  });
});

describe('discardDocument and openDocument', () => {
  it('marks the row deleted and removes the bytes at once', async () => {
    const r = await saveDocument(input(pdf()));
    if (!r.ok) throw new Error(r.code);
    const gone = await discardDocument(r.document.id, 'user_1');
    expect(gone?.deletedBy).toBe('user_1');
    expect(gone?.deletedAt).toBeInstanceOf(Date);
    expect(await openDocument(r.document)).toBeNull();
    expect(await discardDocument(r.document.id, 'user_1')).toBeUndefined();
  });

  it('opens nothing when the vault is off', async () => {
    const r = await saveDocument(input(pdf()));
    if (!r.ok) throw new Error(r.code);
    _setVaultStoreForTests(null);
    expect(await openDocument(r.document)).toBeNull();
  });
});
