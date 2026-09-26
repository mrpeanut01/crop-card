import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_OWNER_ENDPOINT,
  announceOwnerToTabs,
  classifySubmitFailure,
  expectedOwnerDecision,
  fetchServerActiveOwner,
  isStaleOwner,
  watchOwnerSwitches
} from './ownerSync';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function response(init: { ok: boolean; header?: string | null; body?: unknown }) {
  return {
    ok: init.ok,
    status: init.ok ? 200 : 401,
    headers: new Headers(init.header ? { 'x-cropcard-owner': init.header } : {}),
    json: async () => init.body
  } as unknown as Response;
}

describe('expectedOwnerDecision', () => {
  it('allows requests without the header', () => {
    expect(expectedOwnerDecision(null, 'owner_a')).toBe('allow');
    expect(expectedOwnerDecision(undefined, 'owner_a')).toBe('allow');
  });

  it('allows a matching Owner and refuses any other value, including empty', () => {
    expect(expectedOwnerDecision('owner_a', 'owner_a')).toBe('allow');
    expect(expectedOwnerDecision('owner_b', 'owner_a')).toBe('mismatch');
    expect(expectedOwnerDecision('', 'owner_a')).toBe('mismatch');
  });
});

describe('classifySubmitFailure', () => {
  it('recognises the owner-mismatch 409 before the generic conflict case', () => {
    expect(classifySubmitFailure(409, '{"code":"OWNER_MISMATCH"}')).toBe('owner-mismatch');
    expect(classifySubmitFailure(409, '{"error":"duplicate"}')).toBe('rejected');
  });

  it('parks validation, foreign-ref and kernel refusals', () => {
    for (const s of [400, 404, 410, 413, 422])
      expect(classifySubmitFailure(s, '')).toBe('rejected');
  });

  it('retries statuses that can clear up on their own', () => {
    for (const s of [0, 401, 402, 403, 408, 429, 500, 502, 503]) {
      expect(classifySubmitFailure(s, '')).toBe('retry');
    }
  });
});

describe('isStaleOwner', () => {
  it('flags only a known, different Owner', () => {
    expect(isStaleOwner('owner_a', 'owner_b')).toBe(true);
    expect(isStaleOwner('owner_a', 'owner_a')).toBe(false);
    expect(isStaleOwner(null, 'owner_b')).toBe(false);
    expect(isStaleOwner('owner_a', null)).toBe(false);
  });
});

describe('fetchServerActiveOwner', () => {
  it('reads the owner header and body from the session endpoint', async () => {
    const f = vi.fn(async () =>
      response({ ok: true, header: 'owner_a', body: { activeOwnerId: 'owner_a' } })
    );
    expect(await fetchServerActiveOwner(f)).toBe('owner_a');
    expect(f).toHaveBeenCalledWith(
      ACTIVE_OWNER_ENDPOINT,
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('falls back to either source when the other is missing', async () => {
    expect(
      await fetchServerActiveOwner(async () =>
        response({ ok: true, body: { activeOwnerId: 'owner_b' } })
      )
    ).toBe('owner_b');
    expect(
      await fetchServerActiveOwner(async () =>
        response({ ok: true, header: 'owner_c', body: null })
      )
    ).toBe('owner_c');
  });

  it('returns null when unconfirmed: header/body disagree, non-2xx, or network error', async () => {
    expect(
      await fetchServerActiveOwner(async () =>
        response({ ok: true, header: 'owner_a', body: { activeOwnerId: 'owner_b' } })
      )
    ).toBeNull();
    expect(await fetchServerActiveOwner(async () => response({ ok: false }))).toBeNull();
    expect(
      await fetchServerActiveOwner(async () => {
        throw new TypeError('offline');
      })
    ).toBeNull();
  });
});

describe('watchOwnerSwitches', () => {
  it('reports announcements from other tabs via the storage event', () => {
    const seen: string[] = [];
    const stop = watchOwnerSwitches(
      (o) => seen.push(o),
      async () => response({ ok: false })
    );
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'cropcard.ownerAnnounce',
        newValue: JSON.stringify({ ownerId: 'owner_b', at: 1 })
      })
    );
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: '{}' }));
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'cropcard.ownerAnnounce', newValue: 'not json' })
    );
    stop();
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'cropcard.ownerAnnounce',
        newValue: JSON.stringify({ ownerId: 'owner_c', at: 2 })
      })
    );
    expect(seen).toEqual(['owner_b']);
  });

  it('re-checks the server when the tab becomes visible', async () => {
    const seen: string[] = [];
    const f = vi.fn(async () =>
      response({ ok: true, header: 'owner_b', body: { activeOwnerId: 'owner_b' } })
    );
    const stop = watchOwnerSwitches((o) => seen.push(o), f);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(seen).toEqual(['owner_b']));
    stop();
  });

  it('delivers over BroadcastChannel to other listeners, not back to the announcer', async () => {
    const announced: unknown[] = [];
    class FakeChannel extends EventTarget {
      static peers = new Set<FakeChannel>();
      constructor(public name: string) {
        super();
        FakeChannel.peers.add(this);
      }
      postMessage(data: unknown) {
        announced.push(data);
        for (const p of FakeChannel.peers) {
          if (p !== this) p.dispatchEvent(new MessageEvent('message', { data }));
        }
      }
      close() {
        FakeChannel.peers.delete(this);
      }
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel);

    const seen: string[] = [];
    const stop = watchOwnerSwitches(
      (o) => seen.push(o),
      async () => response({ ok: false })
    );
    announceOwnerToTabs('owner_b');
    announceOwnerToTabs(null);
    stop();
    announceOwnerToTabs('owner_c');

    expect(seen).toEqual(['owner_b']);
    expect(announced).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem('cropcard.ownerAnnounce')!).ownerId).toBe('owner_c');
  });
});
