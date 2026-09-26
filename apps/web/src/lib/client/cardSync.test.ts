import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import { clearCardCaches, loadSnapshot, saveSnapshot } from './cardStore';
import { SNAPSHOT_EVENT, SNAPSHOT_URL, syncCardSnapshot } from './cardSync';
import { resetTenantCaches } from './tenantSwitch';

const ACTIVE_KEY = 'cropcard.activeOwnerId';

function respond(status: number, body?: unknown, etag?: string): Response {
  const headers = new Headers();
  if (etag) headers.set('etag', etag);
  if (status === 304) return new Response(null, { status, headers });
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

beforeEach(async () => {
  await clearCardCaches();
  sessionStorage.clear();
  setOnline(true);
});

afterEach(() => {
  setOnline(true);
});

describe('syncCardSnapshot', () => {
  it('stores a fresh bundle with its ETag for the active Owner', async () => {
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    const bundle = sampleSnapshot();
    const fetchImpl = vi.fn(async () => respond(200, bundle, 'W/"v1"'));
    const seen: string[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail.outcome);
    window.addEventListener(SNAPSHOT_EVENT, listener);

    expect(await syncCardSnapshot({ fetchImpl, now: () => 5 })).toBe('updated');
    window.removeEventListener(SNAPSHOT_EVENT, listener);

    expect(fetchImpl).toHaveBeenCalledWith(
      SNAPSHOT_URL,
      expect.objectContaining({ headers: { accept: 'application/json' } })
    );
    const row = await loadSnapshot();
    expect(row?.etag).toBe('W/"v1"');
    expect(row?.fetchedAt).toBe(5);
    expect(row?.bundle.farmName).toBe('Goose Creek');
    expect(seen).toEqual(['updated']);
  });

  it('sends If-None-Match and, on 304, keeps the bundle and moves its as-of time', async () => {
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    await saveSnapshot(sampleSnapshot(), 'W/"v1"', 1);
    const fetchImpl = vi.fn(async () => respond(304));
    expect(await syncCardSnapshot({ fetchImpl, now: () => 99 })).toBe('unchanged');
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({ accept: 'application/json', 'if-none-match': 'W/"v1"' });
    const row = await loadSnapshot();
    expect(row?.etag).toBe('W/"v1"');
    expect(row?.fetchedAt).toBe(99);
    expect(row?.bundle.generatedAt).toBe(99);
  });

  it('never stores a bundle for a different Owner (switch in another tab)', async () => {
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    const fetchImpl = vi.fn(async () => respond(200, sampleSnapshot({ ownerId: 'owner_b' }), 'x'));
    expect(await syncCardSnapshot({ fetchImpl })).toBe('owner-mismatch');
    expect(await loadSnapshot()).toBeNull();
    sessionStorage.setItem(ACTIVE_KEY, 'owner_b');
    expect(await loadSnapshot()).toBeNull();
  });

  it('does nothing offline or without an active Owner', async () => {
    const fetchImpl = vi.fn(async () => respond(200, sampleSnapshot()));
    expect(await syncCardSnapshot({ fetchImpl })).toBe('no-owner');
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    setOnline(false);
    expect(await syncCardSnapshot({ fetchImpl })).toBe('offline');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports network failures, auth failures and junk without touching the store', async () => {
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    await saveSnapshot(sampleSnapshot(), 'W/"v1"', 1);
    const cases: [() => Promise<Response>, string][] = [
      [async () => Promise.reject(new TypeError('Failed to fetch')), 'offline'],
      [async () => respond(401, { error: 'x' }), 'unauthorized'],
      [async () => respond(500, { error: 'x' }), 'error'],
      [async () => respond(200, { nope: true }), 'error']
    ];
    for (const [impl, outcome] of cases) {
      expect(await syncCardSnapshot({ fetchImpl: vi.fn(impl) })).toBe(outcome);
    }
    expect((await loadSnapshot())?.fetchedAt).toBe(1);
  });

  it('shares one request between concurrent callers', async () => {
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    const fetchImpl = vi.fn(async () => respond(200, sampleSnapshot(), 'e'));
    const [a, b] = await Promise.all([
      syncCardSnapshot({ fetchImpl }),
      syncCardSnapshot({ fetchImpl })
    ]);
    expect([a, b]).toEqual(['updated', 'updated']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('an Owner switch clears the old farm and the next sync fills the new one', async () => {
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    await syncCardSnapshot({ fetchImpl: vi.fn(async () => respond(200, sampleSnapshot(), 'a')) });
    await resetTenantCaches('owner_b');
    expect(await loadSnapshot()).toBeNull();
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    expect(await loadSnapshot()).toBeNull();
    sessionStorage.setItem(ACTIVE_KEY, 'owner_b');
    const fetchImpl = vi.fn(async () => respond(200, sampleSnapshot({ ownerId: 'owner_b' }), 'b'));
    expect(await syncCardSnapshot({ fetchImpl })).toBe('updated');
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({ accept: 'application/json' });
    expect((await loadSnapshot())?.bundle.ownerId).toBe('owner_b');
  });
});
