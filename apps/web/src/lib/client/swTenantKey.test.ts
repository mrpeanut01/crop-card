import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  BYPASS_KEY_PARAM,
  LEGACY_TENANT_CACHE_NAMES,
  OWNER_HEADER,
  OWNER_KEY_PARAM,
  SET_ACTIVE_OWNER_MESSAGE,
  SW_META_CACHE,
  SW_META_OWNER_URL,
  TENANT_CACHE_NAMES,
  createOwnerStore,
  createTenantCachePlugin,
  installSwTenant,
  isTenantCacheName,
  isValidOwnerId,
  ownerAfterNetworkResponse,
  ownerOfCacheKey,
  parseSetActiveOwnerMessage,
  readDecision,
  tenantCacheKey,
  writeDecision,
  type OwnerStore
} from './swTenantKey';

const ownerArb = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => isValidOwnerId(s));
const pathArb = fc.constantFrom(
  '/api/plugins',
  '/api/sprayers',
  '/today/__data.json',
  '/plan/__data.json'
);
const queryArb = fc.dictionary(
  fc.constantFrom('a', 'type', 'x-sveltekit-invalidated', OWNER_KEY_PARAM, BYPASS_KEY_PARAM),
  fc.string({ maxLength: 12 }),
  { maxKeys: 3 }
);
const urlArb = fc.tuple(pathArb, queryArb).map(([path, q]) => {
  const u = new URL(path, 'https://cropcard.test');
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  return u.toString();
});

interface FakeResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: string;
  text(): Promise<string>;
}

function res(body: string, owner: string | null, status = 200): FakeResponse {
  return {
    status,
    body,
    headers: { get: (n: string) => (n.toLowerCase() === OWNER_HEADER ? owner : null) },
    text: async () => body
  };
}

function fakeCacheStorage() {
  const stores = new Map<string, Map<string, unknown>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (key: string) => m.get(key) as { text(): Promise<string> } | undefined,
      put: async (key: string, value: unknown) => {
        m.set(key, value);
      },
      delete: async (key: string) => m.delete(key)
    };
  };
  return {
    stores,
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name)
  };
}

function memoryStore(initial: string | null = null): OwnerStore & { value: string | null } {
  const s = {
    value: initial,
    async get() {
      return s.value;
    },
    async set(v: string | null) {
      s.value = v;
    }
  };
  return s;
}

/** Minimal Workbox StrategyHandler emulation: read → key(read) → match →
 *  cachedResponseWillBeUsed; write → key(write) → cacheWillUpdate → put. */
function workboxSim(store: OwnerStore) {
  const plugin = createTenantCachePlugin(store);
  const cache = new Map<string, FakeResponse>();
  return {
    cache,
    async read(url: string) {
      const key = await plugin.cacheKeyWillBeUsed({ request: { url }, mode: 'read', state: {} });
      const hit = cache.get(key) ?? null;
      return (await plugin.cachedResponseWillBeUsed({
        request: { url: key },
        cachedResponse: hit
      })) as FakeResponse | null;
    },
    async write(url: string, response: FakeResponse) {
      const state: Record<string, unknown> = {};
      const key = await plugin.cacheKeyWillBeUsed({ request: { url }, mode: 'write', state });
      const ok = await plugin.cacheWillUpdate({ response, state });
      if (ok) cache.set(key, response);
      return !!ok;
    },
    async network(response: FakeResponse) {
      return plugin.fetchDidSucceed({ response });
    }
  };
}

describe('tenantCacheKey / ownerOfCacheKey', () => {
  it('appends the owner param and round-trips', () => {
    const key = tenantCacheKey('https://x.test/api/plugins?type=crop', 'owner_a');
    expect(new URL(key).searchParams.get(OWNER_KEY_PARAM)).toBe('owner_a');
    expect(new URL(key).searchParams.get('type')).toBe('crop');
    expect(ownerOfCacheKey(key)).toBe('owner_a');
  });

  it('unknown owner yields a bypass key with no owner', () => {
    for (const o of [null, undefined, '', ' padded ']) {
      const key = tenantCacheKey('https://x.test/api/plugins', o);
      expect(new URL(key).searchParams.has(BYPASS_KEY_PARAM)).toBe(true);
      expect(ownerOfCacheKey(key)).toBeNull();
    }
  });

  it('a caller-supplied __cc_owner param cannot spoof the namespace', () => {
    const key = tenantCacheKey(`https://x.test/api/plugins?${OWNER_KEY_PARAM}=owner_b`, 'owner_a');
    expect(ownerOfCacheKey(key)).toBe('owner_a');
    expect(new URL(key).searchParams.getAll(OWNER_KEY_PARAM)).toEqual(['owner_a']);
  });

  it('raw (legacy, un-namespaced) keys have no owner', () => {
    expect(ownerOfCacheKey('https://x.test/api/plugins')).toBeNull();
    expect(ownerOfCacheKey('not a url')).toBeNull();
  });

  it('property: a key built for owner A never equals a key for owner B', () => {
    fc.assert(
      fc.property(urlArb, urlArb, ownerArb, ownerArb, (u1, u2, a, b) => {
        fc.pre(a !== b);
        expect(tenantCacheKey(u1, a)).not.toBe(tenantCacheKey(u2, b));
      }),
      { numRuns: 500 }
    );
  });

  it('property: key(url, A) resolves to owner A and B never gets a serve decision on it', () => {
    fc.assert(
      fc.property(urlArb, ownerArb, ownerArb, (u, a, b) => {
        const key = tenantCacheKey(u, a);
        expect(ownerOfCacheKey(key)).toBe(a);
        expect(readDecision(a, key, a)).toBe('serve');
        if (a !== b) expect(readDecision(b, key, b)).toBe('bypass');
      }),
      { numRuns: 500 }
    );
  });

  it('property: same owner + same url is stable (cache hits survive a switch back)', () => {
    fc.assert(
      fc.property(urlArb, ownerArb, (u, a) => {
        expect(tenantCacheKey(u, a)).toBe(tenantCacheKey(tenantCacheKey(u, a), a));
      })
    );
  });
});

describe('readDecision / writeDecision', () => {
  it('property: unknown active owner always bypasses reads and skips writes', () => {
    fc.assert(
      fc.property(
        urlArb,
        fc.option(ownerArb),
        fc.option(ownerArb),
        fc.constantFrom(null, undefined, ''),
        (u, keyOwner, respOwner, active) => {
          const key = tenantCacheKey(u, keyOwner);
          expect(readDecision(active, key, respOwner)).toBe('bypass');
          expect(
            writeDecision({
              activeOwnerId: active,
              keyOwnerId: keyOwner,
              responseOwnerId: respOwner,
              status: 200
            })
          ).toBe('skip');
        }
      )
    );
  });

  it('property: writes only when active, key and response owners all agree on a 200', () => {
    fc.assert(
      fc.property(
        fc.option(ownerArb),
        fc.option(ownerArb),
        fc.option(ownerArb),
        fc.constantFrom(200, 201, 204, 304, 401, 500),
        (active, keyOwner, respOwner, status) => {
          const d = writeDecision({
            activeOwnerId: active,
            keyOwnerId: keyOwner,
            responseOwnerId: respOwner,
            status
          });
          const expected =
            status === 200 && active !== null && active === keyOwner && active === respOwner;
          expect(d === 'write').toBe(expected);
        }
      )
    );
  });

  it('a cached response tagged for another owner is never served', () => {
    const key = tenantCacheKey('https://x.test/api/plugins', 'a');
    expect(readDecision('a', key, 'b')).toBe('bypass');
    expect(readDecision('a', key, null)).toBe('bypass');
  });
});

describe('ownerAfterNetworkResponse', () => {
  it('keeps the owner when the server agrees, demotes to unknown otherwise', () => {
    expect(ownerAfterNetworkResponse('a', 'a')).toBe('a');
    expect(ownerAfterNetworkResponse('a', 'b')).toBeNull();
    expect(ownerAfterNetworkResponse('a', null)).toBeNull();
  });

  it('never promotes an unknown owner from a response (stale in-flight responses)', () => {
    fc.assert(
      fc.property(fc.option(ownerArb), (resp) => {
        expect(ownerAfterNetworkResponse(null, resp)).toBeNull();
      })
    );
  });
});

describe('parseSetActiveOwnerMessage', () => {
  it('accepts well-formed messages and normalizes invalid ids to null', () => {
    expect(parseSetActiveOwnerMessage({ type: SET_ACTIVE_OWNER_MESSAGE, ownerId: 'a' })).toEqual({
      ownerId: 'a',
      wipe: false
    });
    expect(
      parseSetActiveOwnerMessage({ type: SET_ACTIVE_OWNER_MESSAGE, ownerId: 42, wipe: true })
    ).toEqual({ ownerId: null, wipe: true });
    expect(parseSetActiveOwnerMessage({ type: 'SKIP_WAITING' })).toBeNull();
    expect(parseSetActiveOwnerMessage(null)).toBeNull();
    expect(parseSetActiveOwnerMessage('x')).toBeNull();
  });
});

describe('isTenantCacheName', () => {
  it('covers current and legacy tenant caches but not shared ones', () => {
    for (const n of [...TENANT_CACHE_NAMES, ...LEGACY_TENANT_CACHE_NAMES]) {
      expect(isTenantCacheName(n)).toBe(true);
    }
    expect(isTenantCacheName('esri-tiles')).toBe(false);
    expect(isTenantCacheName('workbox-precache-v2-https://x.test/')).toBe(false);
  });
});

describe('createTenantCachePlugin (Workbox emulation)', () => {
  it('switching owners keeps both namespaces and never cross-serves', async () => {
    const store = memoryStore('a');
    const wb = workboxSim(store);
    const url = 'https://x.test/api/plugins';
    expect(await wb.write(url, res('A-data', 'a'))).toBe(true);

    store.value = 'b';
    expect(await wb.read(url)).toBeNull();
    expect(await wb.write(url, res('B-data', 'b'))).toBe(true);
    expect((await wb.read(url))?.body).toBe('B-data');

    store.value = 'a';
    expect((await wb.read(url))?.body).toBe('A-data');
    expect(wb.cache.size).toBe(2);
  });

  it('unknown owner: no read, no write (network-only)', async () => {
    const store = memoryStore('a');
    const wb = workboxSim(store);
    const url = 'https://x.test/api/sprayers';
    await wb.write(url, res('A', 'a'));
    store.value = null;
    expect(await wb.read(url)).toBeNull();
    expect(await wb.write(url, res('A2', 'a'))).toBe(false);
    expect(wb.cache.size).toBe(1);
  });

  it('refuses to cache a response rendered for a different owner than the key', async () => {
    const store = memoryStore('a');
    const wb = workboxSim(store);
    expect(await wb.write('https://x.test/api/plugins', res('B', 'b'))).toBe(false);
    expect(await wb.write('https://x.test/api/plugins', res('none', null))).toBe(false);
    expect(await wb.write('https://x.test/api/plugins', res('err', 'a', 500))).toBe(false);
  });

  it('a mismatched network response demotes the SW to unknown owner', async () => {
    const store = memoryStore('a');
    const wb = workboxSim(store);
    await wb.network(res('ok', 'a'));
    expect(store.value).toBe('a');
    await wb.network(res('switched elsewhere', 'b'));
    expect(store.value).toBeNull();
  });

  it('property: across arbitrary op sequences, a read never returns another owner’s data', async () => {
    const op = fc.oneof(
      fc.record({
        kind: fc.constant('set' as const),
        owner: fc.option(fc.constantFrom('a', 'b', 'c'))
      }),
      fc.record({
        kind: fc.constant('write' as const),
        url: pathArb,
        respOwner: fc.option(fc.constantFrom('a', 'b', 'c')),
        status: fc.constantFrom(200, 200, 500)
      }),
      fc.record({ kind: fc.constant('read' as const), url: pathArb }),
      fc.record({
        kind: fc.constant('net' as const),
        respOwner: fc.option(fc.constantFrom('a', 'b'))
      })
    );
    await fc.assert(
      fc.asyncProperty(fc.array(op, { maxLength: 40 }), async (ops) => {
        const store = memoryStore(null);
        const wb = workboxSim(store);
        for (const o of ops) {
          const full = (p: string) => new URL(p, 'https://x.test').toString();
          if (o.kind === 'set') store.value = o.owner;
          else if (o.kind === 'write') {
            await wb.write(full(o.url), res(`${o.respOwner}:${o.url}`, o.respOwner, o.status));
          } else if (o.kind === 'net') {
            await wb.network(res('', o.respOwner));
          } else {
            const hit = await wb.read(full(o.url));
            if (store.value === null) expect(hit).toBeNull();
            if (hit) {
              expect(hit.headers.get(OWNER_HEADER)).toBe(store.value);
              expect(hit.body).toBe(`${store.value}:${o.url}`);
            }
          }
        }
        for (const [key, value] of wb.cache) {
          expect(ownerOfCacheKey(key)).toBe(value.headers.get(OWNER_HEADER));
        }
      }),
      { numRuns: 300 }
    );
  });
});

describe('createOwnerStore', () => {
  it('persists the active owner to the meta cache and reloads it after SW restart', async () => {
    const cs = fakeCacheStorage();
    const make = (b: string) => res(b, null);
    const first = createOwnerStore(cs, make);
    await first.set('owner_a');
    expect(cs.stores.get(SW_META_CACHE)?.has(SW_META_OWNER_URL)).toBe(true);

    const restarted = createOwnerStore(cs, make);
    expect(await restarted.get()).toBe('owner_a');

    await restarted.set(null);
    expect(cs.stores.get(SW_META_CACHE)?.has(SW_META_OWNER_URL)).toBe(false);
    expect(await createOwnerStore(cs, make).get()).toBeNull();
  });

  it('fails safe to unknown when Cache Storage is unavailable or throws', async () => {
    expect(await createOwnerStore(undefined, (b) => b).get()).toBeNull();
    const broken = {
      open: async () => {
        throw new Error('nope');
      },
      keys: async () => [],
      delete: async () => false
    };
    const s = createOwnerStore(broken, (b) => b);
    expect(await s.get()).toBeNull();
    await s.set('a');
    expect(await s.get()).toBe('a');
  });

  it('a set() that races an in-flight initial load wins', async () => {
    const cs = fakeCacheStorage();
    await createOwnerStore(cs, (b) => res(b, null)).set('stale');
    const s = createOwnerStore(cs, (b) => res(b, null));
    const pending = s.get();
    await s.set('fresh');
    await pending;
    expect(await s.get()).toBe('fresh');
  });
});

describe('installSwTenant', () => {
  function fakeScope() {
    const cs = fakeCacheStorage();
    const listeners: Record<string, ((e: never) => void)[]> = {};
    return {
      caches: cs,
      listeners,
      addEventListener(type: string, fn: (e: never) => void) {
        (listeners[type] ??= []).push(fn);
      },
      async dispatch(type: string, event: Record<string, unknown>) {
        const pending: Promise<unknown>[] = [];
        const e = { ...event, waitUntil: (p: Promise<unknown>) => pending.push(p) };
        for (const fn of listeners[type] ?? []) fn(e as never);
        await Promise.all(pending);
      }
    };
  }

  it('messages set the owner, ack via port, and wipe only on request', async () => {
    const scope = fakeScope();
    const plugin = installSwTenant(scope, (b) => res(b, null));
    await scope.caches.open('cropcard-tenant-plugins');
    await scope.caches.open('esri-tiles');

    const acks: unknown[] = [];
    await scope.dispatch('message', {
      data: { type: SET_ACTIVE_OWNER_MESSAGE, ownerId: 'a' },
      ports: [{ postMessage: (m: unknown) => acks.push(m) }]
    });
    expect(acks).toEqual([{ ok: true, ownerId: 'a' }]);
    const key = await plugin.cacheKeyWillBeUsed({
      request: { url: 'https://x.test/api/plugins' },
      mode: 'read'
    });
    expect(ownerOfCacheKey(key)).toBe('a');
    expect(scope.caches.stores.has('cropcard-tenant-plugins')).toBe(true);

    await scope.dispatch('message', {
      data: { type: SET_ACTIVE_OWNER_MESSAGE, ownerId: null, wipe: true }
    });
    expect(scope.caches.stores.has('cropcard-tenant-plugins')).toBe(false);
    expect(scope.caches.stores.has('esri-tiles')).toBe(true);
    const bypass = await plugin.cacheKeyWillBeUsed({
      request: { url: 'https://x.test/api/plugins' },
      mode: 'read'
    });
    expect(ownerOfCacheKey(bypass)).toBeNull();
  });

  it('ignores unrelated messages', async () => {
    const scope = fakeScope();
    const plugin = installSwTenant(scope, (b) => res(b, null));
    await scope.dispatch('message', { data: { type: SET_ACTIVE_OWNER_MESSAGE, ownerId: 'a' } });
    await scope.dispatch('message', { data: { type: 'SKIP_WAITING' } });
    const key = await plugin.cacheKeyWillBeUsed({
      request: { url: 'https://x.test/api/plugins' },
      mode: 'read'
    });
    expect(ownerOfCacheKey(key)).toBe('a');
  });

  it('activate purges the legacy un-namespaced caches', async () => {
    const scope = fakeScope();
    installSwTenant(scope, (b) => res(b, null));
    for (const n of [...LEGACY_TENANT_CACHE_NAMES, 'cropcard-tenant-data', 'osm-tiles']) {
      await scope.caches.open(n);
    }
    await scope.dispatch('activate', {});
    for (const n of LEGACY_TENANT_CACHE_NAMES) expect(scope.caches.stores.has(n)).toBe(false);
    expect(scope.caches.stores.has('cropcard-tenant-data')).toBe(true);
    expect(scope.caches.stores.has('osm-tiles')).toBe(true);
  });
});
