/**
 * Per-tenant namespacing for the service worker's runtime caches.
 *
 * This file must stay import-free: vite.config.ts compiles it verbatim into
 * a classic script (`sw-tenant.js`) that the generated Workbox SW loads via
 * `importScripts`. The same source is unit-tested directly.
 *
 * Contract:
 * - Tenant-scoped runtime cache entries are keyed by the active Owner id
 *   (`?__cc_owner=<id>` appended to the request URL), so an Owner switch no
 *   longer has to wipe the cache and a lookup for Owner B can never match an
 *   entry written for Owner A.
 * - Unknown active Owner ⇒ bypass: no cache read, no cache write.
 * - A response is written only when the server's `x-cropcard-owner` header
 *   equals both the active Owner and the Owner baked into the cache key.
 * - A network response whose owner header disagrees with the SW's active
 *   Owner demotes the SW to "unknown" until the page re-announces.
 */

export const OWNER_KEY_PARAM = '__cc_owner';
export const BYPASS_KEY_PARAM = '__cc_bypass';
export const OWNER_HEADER = 'x-cropcard-owner';
export const SET_ACTIVE_OWNER_MESSAGE = 'cropcard:set-active-owner';

export const TENANT_CACHE_NAMES = [
  'cropcard-tenant-plugins',
  'cropcard-tenant-sprayers',
  'cropcard-tenant-data',
  'cropcard-tenant-pages',
  'cropcard-tenant-cards'
] as const;
export const LEGACY_TENANT_CACHE_NAMES = ['cropcard-plugins', 'cropcard-sprayers'] as const;
export const SW_META_CACHE = 'cropcard-sw-meta';
export const SW_META_OWNER_URL = '/__cropcard/sw/active-owner';

const MAX_OWNER_ID_LENGTH = 200;

export function isValidOwnerId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_OWNER_ID_LENGTH &&
    value.trim() === value
  );
}

function stripTenantParams(url: URL): void {
  url.searchParams.delete(OWNER_KEY_PARAM);
  url.searchParams.delete(BYPASS_KEY_PARAM);
}

export function tenantCacheKey(requestUrl: string, ownerId: string | null | undefined): string {
  const url = new URL(requestUrl);
  stripTenantParams(url);
  if (isValidOwnerId(ownerId)) {
    url.searchParams.set(OWNER_KEY_PARAM, ownerId);
  } else {
    url.searchParams.set(BYPASS_KEY_PARAM, '1');
  }
  return url.toString();
}

export function ownerOfCacheKey(key: string): string | null {
  let url: URL;
  try {
    url = new URL(key);
  } catch {
    return null;
  }
  if (url.searchParams.has(BYPASS_KEY_PARAM)) return null;
  const owners = url.searchParams.getAll(OWNER_KEY_PARAM);
  if (owners.length !== 1) return null;
  return isValidOwnerId(owners[0]) ? owners[0] : null;
}

export type ReadDecision = 'serve' | 'bypass';

export function readDecision(
  activeOwnerId: string | null | undefined,
  cacheKey: string,
  cachedResponseOwner: string | null | undefined
): ReadDecision {
  if (!isValidOwnerId(activeOwnerId)) return 'bypass';
  if (ownerOfCacheKey(cacheKey) !== activeOwnerId) return 'bypass';
  if (cachedResponseOwner !== activeOwnerId) return 'bypass';
  return 'serve';
}

export type WriteDecision = 'write' | 'skip';

export function writeDecision(input: {
  activeOwnerId: string | null | undefined;
  keyOwnerId: string | null | undefined;
  responseOwnerId: string | null | undefined;
  status: number;
}): WriteDecision {
  const { activeOwnerId, keyOwnerId, responseOwnerId, status } = input;
  if (status !== 200) return 'skip';
  if (!isValidOwnerId(activeOwnerId)) return 'skip';
  if (keyOwnerId !== activeOwnerId) return 'skip';
  if (responseOwnerId !== activeOwnerId) return 'skip';
  return 'write';
}

export function ownerAfterNetworkResponse(
  activeOwnerId: string | null,
  responseOwnerId: string | null | undefined
): string | null {
  if (activeOwnerId === null) return null;
  return responseOwnerId === activeOwnerId ? activeOwnerId : null;
}

export interface SetActiveOwnerMessage {
  ownerId: string | null;
  wipe: boolean;
}

export function parseSetActiveOwnerMessage(data: unknown): SetActiveOwnerMessage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type !== SET_ACTIVE_OWNER_MESSAGE) return null;
  const ownerId = isValidOwnerId(d.ownerId) ? d.ownerId : null;
  return { ownerId, wipe: d.wipe === true };
}

export function isTenantCacheName(name: string): boolean {
  return (
    (TENANT_CACHE_NAMES as readonly string[]).includes(name) ||
    (LEGACY_TENANT_CACHE_NAMES as readonly string[]).includes(name)
  );
}

export interface OwnerStore {
  get(): Promise<string | null>;
  set(ownerId: string | null): Promise<void>;
}

interface CacheStorageLike {
  open(name: string): Promise<{
    match(key: string): Promise<{ text(): Promise<string> } | undefined>;
    put(key: string, response: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
  }>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

export function createOwnerStore(
  cacheStorage: CacheStorageLike | undefined,
  makeResponse: (body: string) => unknown
): OwnerStore {
  let loaded = false;
  let owner: string | null = null;
  let generation = 0;
  return {
    async get() {
      if (loaded) return owner;
      const startedAt = generation;
      let persisted: string | null = null;
      try {
        const cache = await cacheStorage?.open(SW_META_CACHE);
        const hit = await cache?.match(SW_META_OWNER_URL);
        const text = hit ? await hit.text() : null;
        persisted = isValidOwnerId(text) ? text : null;
      } catch {
        persisted = null;
      }
      if (!loaded && startedAt === generation) {
        owner = persisted;
        loaded = true;
      }
      return owner;
    },
    async set(next) {
      generation += 1;
      owner = isValidOwnerId(next) ? next : null;
      loaded = true;
      try {
        const cache = await cacheStorage?.open(SW_META_CACHE);
        if (!cache) return;
        if (owner) await cache.put(SW_META_OWNER_URL, makeResponse(owner));
        else await cache.delete(SW_META_OWNER_URL);
      } catch {
        /* in-memory value still governs this SW lifetime */
      }
    }
  };
}

interface RequestLike {
  url: string;
}
interface ResponseLike {
  status: number;
  headers: { get(name: string): string | null };
}
type PluginState = Record<string, unknown> | undefined;

export interface TenantCachePlugin {
  cacheKeyWillBeUsed(p: {
    request: RequestLike;
    mode: string;
    state?: PluginState;
  }): Promise<string>;
  cachedResponseWillBeUsed(p: {
    request: RequestLike;
    cachedResponse?: ResponseLike | null;
    state?: PluginState;
  }): Promise<ResponseLike | null>;
  cacheWillUpdate(p: { response: ResponseLike; state?: PluginState }): Promise<ResponseLike | null>;
  fetchDidSucceed(p: { response: ResponseLike }): Promise<ResponseLike>;
}

const WRITE_KEY_OWNER = 'cropcardWriteKeyOwner';

export function createTenantCachePlugin(store: OwnerStore): TenantCachePlugin {
  return {
    async cacheKeyWillBeUsed({ request, mode, state }) {
      const owner = await store.get();
      if (mode === 'write' && state) state[WRITE_KEY_OWNER] = owner;
      return tenantCacheKey(request.url, owner);
    },
    async cachedResponseWillBeUsed({ request, cachedResponse }) {
      if (!cachedResponse) return null;
      const owner = await store.get();
      const decision = readDecision(owner, request.url, cachedResponse.headers.get(OWNER_HEADER));
      return decision === 'serve' ? cachedResponse : null;
    },
    async cacheWillUpdate({ response, state }) {
      const owner = await store.get();
      const keyOwner = state ? (state[WRITE_KEY_OWNER] as string | null | undefined) : undefined;
      const decision = writeDecision({
        activeOwnerId: owner,
        keyOwnerId: keyOwner,
        responseOwnerId: response.headers.get(OWNER_HEADER),
        status: response.status
      });
      return decision === 'write' ? response : null;
    },
    async fetchDidSucceed({ response }) {
      const owner = await store.get();
      const next = ownerAfterNetworkResponse(owner, response.headers.get(OWNER_HEADER));
      if (next !== owner) await store.set(next);
      return response;
    }
  };
}

interface SwScopeLike {
  caches?: CacheStorageLike;
  addEventListener(
    type: 'message',
    listener: (event: {
      data: unknown;
      ports?: ReadonlyArray<{ postMessage(msg: unknown): void }>;
      waitUntil?(p: Promise<unknown>): void;
    }) => void
  ): void;
  addEventListener(
    type: 'activate',
    listener: (event: { waitUntil?(p: Promise<unknown>): void }) => void
  ): void;
}

export async function deleteTenantCaches(
  cacheStorage: CacheStorageLike | undefined,
  names: readonly string[]
): Promise<void> {
  if (!cacheStorage) return;
  const existing = await cacheStorage.keys();
  await Promise.all(existing.filter((n) => names.includes(n)).map((n) => cacheStorage.delete(n)));
}

export function installSwTenant(
  scope: SwScopeLike,
  makeResponse: (body: string) => unknown
): TenantCachePlugin {
  const store = createOwnerStore(scope.caches, makeResponse);
  scope.addEventListener('message', (event) => {
    const msg = parseSetActiveOwnerMessage(event.data);
    if (!msg) return;
    const work = (async () => {
      await store.set(msg.ownerId);
      if (msg.wipe) {
        await deleteTenantCaches(scope.caches, [
          ...TENANT_CACHE_NAMES,
          ...LEGACY_TENANT_CACHE_NAMES
        ]).catch(() => undefined);
      }
      event.ports?.[0]?.postMessage({ ok: true, ownerId: msg.ownerId });
    })();
    event.waitUntil?.(work);
  });
  scope.addEventListener('activate', (event) => {
    event.waitUntil?.(
      deleteTenantCaches(scope.caches, LEGACY_TENANT_CACHE_NAMES).catch(() => undefined)
    );
  });
  return createTenantCachePlugin(store);
}
