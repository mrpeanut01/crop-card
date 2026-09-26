/**
 * Stale-tab guard for the offline queue (Invariant 6, client side). A tab
 * primes `cropcard.activeOwnerId` once; a switch in another tab moves the
 * shared cookie. These tests run a fake server whose session Owner can
 * differ from the tab's and check that the queue never replays a row
 * against the wrong farm, and that definitive 4xx rows stop retrying.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { db, type PendingRecordKind, type PendingSprayRecord } from './dexie';
import { ACTIVE_OWNER_ENDPOINT, EXPECTED_OWNER_HEADER, OWNER_MISMATCH_CODE } from './ownerSync';
import { discardPendingForActiveOwner, drainQueue, retryRejectedForActiveOwner } from './syncQueue';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';

const ACTIVE_KEY = 'cropcard.activeOwnerId';
const OWNERS = ['owner_a', 'owner_b', 'owner_c'] as const;
const KINDS: PendingRecordKind[] = [
  'herbicide',
  'insecticide',
  'fungicide',
  'harvest',
  'hay-cutting',
  'scout'
];

interface FakeServer {
  owner: string | null;
  /** Switch the session to this Owner after this many record POSTs. */
  switchAfter?: { posts: number; to: string };
  /** Status to answer for a marker; 200 when absent. */
  statusFor: Map<string, number>;
  /** Record POSTs the server actually ran (guard passed). */
  ran: Array<{ url: string; marker: string; owner: string }>;
  refused: number;
}

function installServer(server: FakeServer): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === ACTIVE_OWNER_ENDPOINT) {
        return server.owner
          ? {
              ok: true,
              status: 200,
              headers: new Headers({ 'x-cropcard-owner': server.owner }),
              json: async () => ({ activeOwnerId: server.owner })
            }
          : { ok: false, status: 401, headers: new Headers(), json: async () => ({}) };
      }
      if (server.switchAfter && server.ran.length >= server.switchAfter.posts) {
        server.owner = server.switchAfter.to;
      }
      const expected = (init.headers as Record<string, string>)[EXPECTED_OWNER_HEADER];
      if (!server.owner || expected !== server.owner) {
        server.refused++;
        return {
          ok: false,
          status: 409,
          text: async (): Promise<string> => JSON.stringify({ code: OWNER_MISMATCH_CODE })
        };
      }
      const { marker } = JSON.parse(String(init.body)) as { marker: string };
      server.ran.push({ url, marker, owner: server.owner });
      const status = server.statusFor.get(marker) ?? 200;
      return status === 200
        ? {
            ok: true,
            status,
            text: async (): Promise<string> => '{}',
            json: async () => ({ ok: true })
          }
        : {
            ok: false,
            status,
            text: async (): Promise<string> =>
              status === 400 ? '{"error":"unknown blockId"}' : 'nope'
          };
    })
  );
}

function newServer(owner: string | null): FakeServer {
  return { owner, statusFor: new Map(), ran: [], refused: 0 };
}

async function seed(rows: Array<{ ownerId: string; kind?: PendingRecordKind }>) {
  const recs: PendingSprayRecord[] = rows.map((r, i) => ({
    id: `row_${i}`,
    ownerId: r.ownerId,
    kind: r.kind ?? 'herbicide',
    occurredAt: i,
    payload: { marker: `row_${i}` },
    attempts: 0,
    createdAt: i
  }));
  await db().pendingSprayRecords.bulkPut(recs);
  return recs;
}

async function snapshot() {
  const all = await db().pendingSprayRecords.toArray();
  return new Map(all.map((r) => [r.id, r]));
}

beforeEach(async () => {
  await db().pendingSprayRecords.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('drainQueue — server-confirmed active Owner', () => {
  it('a stale tab (tab = A, session = B) posts nothing and leaves every row untouched', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({ ownerId: fc.constantFrom(...OWNERS), kind: fc.constantFrom(...KINDS) }),
          { maxLength: 20 }
        ),
        fc.constantFrom(...OWNERS),
        fc.constantFrom(...OWNERS),
        async (rows, tabOwner, sessionOwner) => {
          fc.pre(tabOwner !== sessionOwner);
          await db().pendingSprayRecords.clear();
          await seed(rows);
          sessionStorage.setItem(ACTIVE_KEY, tabOwner);
          const server = newServer(sessionOwner);
          installServer(server);
          const before = await snapshot();

          const result = await drainQueue();

          expect(server.ran).toHaveLength(0);
          expect(server.refused).toBe(0);
          expect(result.succeeded).toHaveLength(0);
          expect(await snapshot()).toEqual(before);
          if (rows.some((r) => r.ownerId === tabOwner)) {
            expect(result.halted).toBe('owner-mismatch');
            expect(result.serverOwnerId).toBe(sessionOwner);
          }
        }
      ),
      { numRuns: 80 }
    );
  });

  it('overlapping drains share one run: each row is POSTed once, with its queue id', async () => {
    await seed([{ ownerId: 'owner_a', kind: 'scout' }, { ownerId: 'owner_a' }]);
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    const server = newServer('owner_a');
    installServer(server);

    const [a, b] = await Promise.all([drainQueue(), drainQueue()]);
    expect(server.ran.map((r) => r.marker).sort()).toEqual(['row_0', 'row_1']);
    expect(a).toBe(b);
    expect(await snapshot()).toEqual(new Map());
    const recordPosts = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => url !== ACTIVE_OWNER_ENDPOINT)
      .map(([, init]) => (init?.headers as Record<string, string>)[CLIENT_RECORD_HEADER]);
    expect(recordPosts.sort()).toEqual(['row_0', 'row_1']);

    await seed([{ ownerId: 'owner_a' }]);
    await drainQueue();
    expect(server.ran).toHaveLength(3);
  });

  it('halts as owner-unverified when the server cannot confirm a session', async () => {
    await seed([{ ownerId: 'owner_a' }]);
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    const server = newServer(null);
    installServer(server);

    const result = await drainQueue();
    expect(result.halted).toBe('owner-unverified');
    expect(server.ran).toHaveLength(0);
    expect((await snapshot()).get('row_0')?.attempts).toBe(0);
  });

  it('does not call the server at all when this tab has nothing to drain', async () => {
    await seed([{ ownerId: 'owner_b' }]);
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    const server = newServer('owner_a');
    installServer(server);

    const result = await drainQueue();
    expect(result).toMatchObject({ halted: null, skippedOtherOwner: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a switch mid-drain stops at the first refused POST; nothing runs under the new Owner', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 12 }), fc.nat({ max: 12 }), async (n, k) => {
        await db().pendingSprayRecords.clear();
        await seed(Array.from({ length: n }, () => ({ ownerId: 'owner_a' })));
        sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
        const server = newServer('owner_a');
        server.switchAfter = { posts: k, to: 'owner_b' };
        installServer(server);

        const result = await drainQueue();
        const after = await snapshot();
        const ranCount = Math.min(k, n);

        expect(server.ran.every((r) => r.owner === 'owner_a')).toBe(true);
        expect(result.succeeded).toHaveLength(ranCount);
        expect(server.refused).toBe(k < n ? 1 : 0);
        expect(result.halted).toBe(k < n ? 'owner-mismatch' : null);
        expect(after.size).toBe(n - ranCount);
        for (const row of after.values()) {
          expect(row.attempts).toBe(0);
          expect(row.status).toBeUndefined();
        }
      }),
      { numRuns: 60 }
    );
  });
});

describe('drainQueue — definitive 4xx stops retrying', () => {
  it('parks a foreign-ref 400 as rejected, skips it on later drains, and retries on request', async () => {
    await seed([{ ownerId: 'owner_a' }, { ownerId: 'owner_a' }]);
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    const server = newServer('owner_a');
    server.statusFor.set('row_0', 400);
    server.statusFor.set('row_1', 503);
    installServer(server);

    const first = await drainQueue();
    expect(first.rejected).toEqual([
      { id: 'row_0', status: 400, error: 'HTTP 400: {"error":"unknown blockId"}' }
    ]);
    expect(first.failed.map((f) => f.id)).toEqual(['row_1']);
    let rows = await snapshot();
    expect(rows.get('row_0')).toMatchObject({ status: 'rejected', lastStatus: 400, attempts: 1 });
    expect(rows.get('row_1')).toMatchObject({ lastStatus: 503, attempts: 1 });
    expect(rows.get('row_1')?.status).toBeUndefined();

    const second = await drainQueue();
    expect(second.skippedRejected).toBe(1);
    expect(second.failed.map((f) => f.id)).toEqual(['row_1']);
    expect(server.ran.filter((r) => r.marker === 'row_0')).toHaveLength(1);

    server.statusFor.delete('row_0');
    expect(await retryRejectedForActiveOwner('row_0')).toBe(true);
    const third = await drainQueue();
    expect(third.succeeded).toEqual(['row_0']);
    rows = await snapshot();
    expect(rows.has('row_0')).toBe(false);
    expect(rows.get('row_1')?.attempts).toBe(3);
  });

  it.each([404, 409, 410, 413, 422])('treats %i as definitive', async (status) => {
    await seed([{ ownerId: 'owner_a' }]);
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    const server = newServer('owner_a');
    server.statusFor.set('row_0', status);
    installServer(server);

    expect((await drainQueue()).rejected.map((r) => r.id)).toEqual(['row_0']);
    expect((await drainQueue()).skippedRejected).toBe(1);
    expect(server.ran).toHaveLength(1);
  });

  it.each([401, 402, 403, 429, 500, 503])('keeps retrying %i', async (status) => {
    await seed([{ ownerId: 'owner_a' }]);
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    const server = newServer('owner_a');
    server.statusFor.set('row_0', status);
    installServer(server);

    await drainQueue();
    await drainQueue();
    expect(server.ran).toHaveLength(2);
    expect((await snapshot()).get('row_0')?.status).toBeUndefined();
  });

  it('retry and discard never act on another Owner’s rejected row', async () => {
    await seed([{ ownerId: 'owner_b' }]);
    await db().pendingSprayRecords.update('row_0', { status: 'rejected', lastStatus: 400 });
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');

    expect(await retryRejectedForActiveOwner('row_0')).toBe(false);
    expect(await discardPendingForActiveOwner('row_0')).toBe(false);
    expect((await snapshot()).get('row_0')).toMatchObject({
      status: 'rejected',
      ownerId: 'owner_b'
    });
  });

  it('retry refuses a row that is not rejected', async () => {
    await seed([{ ownerId: 'owner_a' }]);
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    expect(await retryRejectedForActiveOwner('row_0')).toBe(false);
    expect(await retryRejectedForActiveOwner('row_missing')).toBe(false);
  });
});
