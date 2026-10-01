// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, utimes, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { filesystemVaultStore } from './filesystemStore';
import {
  _setVaultStoreForTests,
  assertVaultKey,
  assertVaultPrefix,
  isVaultKey,
  vaultStatus,
  vaultStore,
  type VaultStore
} from './store';
import { useTestVault } from './testing';

const enc = new TextEncoder();
const key = (owner = 'owner_a') => `owners/${owner}/${randomUUID()}`;

async function text(s: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(s).text();
}

async function all<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('vault keys', () => {
  it('accepts only owners/<ownerId>/<uuid>', () => {
    expect(isVaultKey(key())).toBe(true);
    for (const bad of [
      'owners/a/../b/' + randomUUID(),
      'owners/a/b/' + randomUUID(),
      'owners//' + randomUUID(),
      '/owners/a/' + randomUUID(),
      'owners/a/' + randomUUID() + '/x',
      'owners/a/report.pdf',
      'owners/a b/' + randomUUID(),
      '../etc/passwd',
      ''
    ]) {
      expect(isVaultKey(bad), bad).toBe(false);
      expect(() => assertVaultKey(bad)).toThrow();
    }
  });

  it('accepts only the vault root or one Owner folder as a prefix', () => {
    expect(() => assertVaultPrefix('owners/')).not.toThrow();
    expect(() => assertVaultPrefix('owners/owner_a/')).not.toThrow();
    for (const bad of ['', '/', 'owners', 'owners/a', 'owners/../', 'owners/a/b/', 'x/']) {
      expect(() => assertVaultPrefix(bad), bad).toThrow();
    }
  });
});

describe('vaultStatus', () => {
  afterEach(() => _setVaultStoreForTests(undefined));

  it('is off when VAULT_BACKEND is unset', () => {
    expect(vaultStatus({})).toEqual({ enabled: false, reason: 'not-configured' });
    expect(vaultStore({})).toBeNull();
  });

  it('turns the filesystem backend on with VAULT_DIR', () => {
    const env = { VAULT_BACKEND: 'filesystem', VAULT_DIR: '/tmp/x' };
    expect(vaultStatus(env)).toEqual({ enabled: true, backend: 'filesystem' });
    expect(vaultStore(env)?.backend).toBe('filesystem');
    expect(vaultStore(env)).toBe(vaultStore(env));
  });

  it('refuses the filesystem backend inside Azure Container Apps', () => {
    const env = {
      VAULT_BACKEND: 'filesystem',
      VAULT_DIR: '/data/vault',
      CONTAINER_APP_NAME: 'app'
    };
    expect(vaultStatus(env)).toEqual({ enabled: false, reason: 'filesystem-in-azure' });
    expect(vaultStore(env)).toBeNull();
  });

  it('is off, never a fallback, when a backend is misconfigured', () => {
    for (const env of [
      { VAULT_BACKEND: 'filesystem' },
      { VAULT_BACKEND: 'blob', AZURE_STORAGE_ACCOUNT: 'a', AZURE_STORAGE_KEY: 'k' },
      { VAULT_BACKEND: 'blob', VAULT_BLOB_CONTAINER: 'documents' },
      { VAULT_BACKEND: 's3' }
    ]) {
      expect(vaultStatus(env)).toEqual({ enabled: false, reason: 'misconfigured' });
      expect(vaultStore(env)).toBeNull();
    }
  });

  it('turns the blob backend on with account, key and container', () => {
    const env = {
      VAULT_BACKEND: 'blob',
      AZURE_STORAGE_ACCOUNT: 'acct',
      AZURE_STORAGE_KEY: 'a2V5',
      VAULT_BLOB_CONTAINER: 'documents',
      AZURE_BLOB_CONTAINER: 'litestream'
    };
    expect(vaultStatus(env)).toEqual({ enabled: true, backend: 'blob' });
    expect(vaultStore(env)?.backend).toBe('blob');
  });

  it('useTestVault pins a filesystem store and cleans it up', async () => {
    const v = useTestVault();
    expect(vaultStatus({})).toEqual({ enabled: true, backend: 'filesystem' });
    const store = vaultStore({}) as VaultStore;
    const k = key();
    await store.put(k, enc.encode('x'), { contentType: 'text/csv; charset=utf-8' });
    await v.cleanup();
    expect(vaultStatus({})).toEqual({ enabled: false, reason: 'not-configured' });
  });
});

describe('filesystem store', () => {
  let dir: string;
  let store: VaultStore;

  async function setup() {
    dir = await mkdtemp(path.join(tmpdir(), 'vault-fs-'));
    store = filesystemVaultStore(dir);
  }
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('puts, gets, lists and deletes', async () => {
    await setup();
    const k = key();
    const r = await store.put(k, enc.encode('hello vault'), { contentType: 'application/pdf' });
    expect(r.bytes).toBe(11);
    const got = await store.get(k);
    expect(got?.bytes).toBe(11);
    expect(await text(got!.body)).toBe('hello vault');
    const listed = await all(store.list('owners/owner_a/'));
    expect(listed.map((o) => o.key)).toEqual([k]);
    expect(listed[0].bytes).toBe(11);
    await store.delete(k);
    await store.delete(k);
    expect(await store.get(k)).toBeNull();
  });

  it('streams a ReadableStream and an async iterable body', async () => {
    await setup();
    const k1 = key();
    await store.put(
      k1,
      new ReadableStream({
        start(c) {
          c.enqueue(enc.encode('ab'));
          c.enqueue(enc.encode('cd'));
          c.close();
        }
      }),
      { contentType: 'application/pdf' }
    );
    expect(await text((await store.get(k1))!.body)).toBe('abcd');
    const k2 = key();
    async function* gen() {
      yield enc.encode('x');
      yield enc.encode('yz');
    }
    expect((await store.put(k2, gen(), { contentType: 'application/pdf' })).bytes).toBe(3);
  });

  it('leaves nothing behind when the body fails mid-way', async () => {
    await setup();
    const k = key();
    async function* broken() {
      yield enc.encode('partial');
      throw new Error('client went away');
    }
    await expect(store.put(k, broken(), { contentType: 'application/pdf' })).rejects.toThrow();
    expect(await store.get(k)).toBeNull();
    expect(await readdir(path.join(dir, 'owners/owner_a'))).toEqual([]);
  });

  it('refuses bad keys before any I/O', async () => {
    await setup();
    await expect(
      store.put('owners/a/../../x', enc.encode('x'), { contentType: 'x' })
    ).rejects.toThrow(/invalid vault key/);
    await expect(store.get('../x')).rejects.toThrow(/invalid vault key/);
    await expect(store.delete('owners/a/b')).rejects.toThrow(/invalid vault key/);
    expect(await readdir(dir)).toEqual([]);
  });

  it('lists every Owner under the root and ignores stray files', async () => {
    await setup();
    const a = key('owner_a');
    const b = key('owner_b');
    await store.put(a, enc.encode('a'), { contentType: 'x' });
    await store.put(b, enc.encode('b'), { contentType: 'x' });
    await writeFile(path.join(dir, 'owners/owner_a', 'notes.txt'), 'x');
    await writeFile(path.join(dir, 'owners/owner_a', `${randomUUID()}.tmp-1`), 'x');
    const keys = (await all(store.list('owners/'))).map((o) => o.key).sort();
    expect(keys).toEqual([a, b].sort());
    expect((await all(store.list('owners/owner_b/'))).map((o) => o.key)).toEqual([b]);
    expect(await all(store.list('owners/nobody/'))).toEqual([]);
  });

  it('deletePrefix honours modifiedBefore and keep, and never touches another Owner', async () => {
    await setup();
    const old1 = key('owner_a');
    const old2 = key('owner_a');
    const fresh = key('owner_a');
    const other = key('owner_b');
    for (const k of [old1, old2, fresh, other]) {
      await store.put(k, enc.encode(k), { contentType: 'x' });
    }
    const past = new Date(Date.now() - 3_600_000);
    await utimes(path.join(dir, old1), past, past);
    await utimes(path.join(dir, old2), past, past);
    const n = await store.deletePrefix('owners/owner_a/', {
      modifiedBefore: Date.now() - 60_000,
      keep: (k) => k === old2
    });
    expect(n).toBe(1);
    expect(await store.get(old1)).toBeNull();
    expect(await store.get(old2)).not.toBeNull();
    expect(await store.get(fresh)).not.toBeNull();
    expect(await store.get(other)).not.toBeNull();
    expect(await store.deletePrefix('owners/owner_a/')).toBe(2);
    expect(await store.get(other)).not.toBeNull();
  });

  it('checks the resolved path stays under VAULT_DIR', async () => {
    await setup();
    await mkdir(path.join(dir, 'owners'), { recursive: true });
    expect(() => store.list('owners/../')).toThrow(/invalid vault prefix/);
  });
});
