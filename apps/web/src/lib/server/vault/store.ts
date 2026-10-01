import { blobVaultStore } from './blobStore';
import { filesystemVaultStore } from './filesystemStore';

export type VaultMime =
  'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'text/csv; charset=utf-8';

export const VAULT_MIMES: readonly VaultMime[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/csv; charset=utf-8'
];

export type VaultBody = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array> | Uint8Array;

export interface VaultObject {
  key: string;
  bytes: number;
  lastModified: number;
}

export interface VaultStore {
  readonly backend: 'blob' | 'filesystem';
  put(key: string, body: VaultBody, opts: { contentType: string }): Promise<{ bytes: number }>;
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; bytes: number } | null>;
  delete(key: string): Promise<void>;
  deletePrefix(
    prefix: string,
    opts?: { modifiedBefore?: number; keep?: (key: string) => boolean }
  ): Promise<number>;
  list(prefix: string): AsyncIterable<VaultObject>;
}

export type VaultStatus =
  | { enabled: true; backend: 'blob' | 'filesystem' }
  | { enabled: false; reason: 'not-configured' | 'filesystem-in-azure' | 'misconfigured' };

const KEY_RE = /^owners\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}$/;
const OWNER_PREFIX_RE = /^owners\/[A-Za-z0-9_-]+\/$/;
export const VAULT_ROOT_PREFIX = 'owners/';

export function isVaultKey(key: string): boolean {
  return typeof key === 'string' && KEY_RE.test(key);
}

/** Throws before any I/O unless the key is `owners/<ownerId>/<uuid>`. */
export function assertVaultKey(key: string): void {
  if (!isVaultKey(key)) throw new Error(`invalid vault key: ${JSON.stringify(key)}`);
}

/** Prefixes are either the whole vault (`owners/`) or one Owner's folder. */
export function assertVaultPrefix(prefix: string): void {
  if (prefix === VAULT_ROOT_PREFIX) return;
  if (typeof prefix !== 'string' || !OWNER_PREFIX_RE.test(prefix)) {
    throw new Error(`invalid vault prefix: ${JSON.stringify(prefix)}`);
  }
}

type Env = Record<string, string | undefined>;

interface Resolved {
  status: VaultStatus;
  signature: string;
  make: (() => VaultStore) | null;
}

function resolve(env: Env): Resolved {
  const backend = (env.VAULT_BACKEND ?? '').trim();
  if (!backend) {
    return { status: { enabled: false, reason: 'not-configured' }, signature: 'off', make: null };
  }
  if (backend === 'filesystem') {
    const dir = (env.VAULT_DIR ?? '').trim();
    if (env.CONTAINER_APP_NAME) {
      return {
        status: { enabled: false, reason: 'filesystem-in-azure' },
        signature: 'fs-azure',
        make: null
      };
    }
    if (!dir) {
      return { status: { enabled: false, reason: 'misconfigured' }, signature: 'bad', make: null };
    }
    return {
      status: { enabled: true, backend: 'filesystem' },
      signature: `fs:${dir}`,
      make: () => filesystemVaultStore(dir)
    };
  }
  if (backend === 'blob') {
    const account = (env.AZURE_STORAGE_ACCOUNT ?? '').trim();
    const key = (env.AZURE_STORAGE_KEY ?? '').trim();
    const container = (env.VAULT_BLOB_CONTAINER ?? '').trim();
    const endpoint = (env.AZURE_BLOB_ENDPOINT ?? '').trim() || undefined;
    if (!account || !key || !container) {
      return { status: { enabled: false, reason: 'misconfigured' }, signature: 'bad', make: null };
    }
    return {
      status: { enabled: true, backend: 'blob' },
      signature: `blob:${account}:${container}:${endpoint ?? ''}:${key.length}`,
      make: () => blobVaultStore({ account, key, container, endpoint })
    };
  }
  return { status: { enabled: false, reason: 'misconfigured' }, signature: 'bad', make: null };
}

let cached: { signature: string; store: VaultStore } | null = null;
let override: VaultStore | null | undefined;

/** Read from the environment on every call, so a test or a restart with new
 *  settings never sees a stale answer. A misconfigured backend is off. */
export function vaultStatus(env: Env = process.env): VaultStatus {
  if (override !== undefined) {
    return override
      ? { enabled: true, backend: override.backend }
      : { enabled: false, reason: 'not-configured' };
  }
  return resolve(env).status;
}

export function vaultStore(env: Env = process.env): VaultStore | null {
  if (override !== undefined) return override;
  const r = resolve(env);
  if (!r.make) return null;
  if (!cached || cached.signature !== r.signature) {
    cached = { signature: r.signature, store: r.make() };
  }
  return cached.store;
}

/** Test-only: pin the process store (null turns the vault off); undefined
 *  goes back to reading the environment. */
export function _setVaultStoreForTests(store: VaultStore | null | undefined): void {
  override = store;
  cached = null;
}

export const VAULT_OFF_MESSAGE = "Document storage isn't set up yet.";
