/**
 * #278 — cross-tenant property test for the Dexie-backed offline queue
 * (Invariant 6, client side). Mirrors `lib/db/tenant.crossTenant.test.ts`:
 * for arbitrary interleavings of queued rows across N owners and every
 * record kind, the owner-scoped helpers never list, drain, or discard
 * another owner's rows, and an unknown active owner never drains.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { db, type PendingRecordKind, type PendingSprayRecord } from './dexie';
import { ACTIVE_OWNER_ENDPOINT, EXPECTED_OWNER_HEADER } from './ownerSync';
import {
  ENDPOINT_BY_KIND,
  UNASSIGNED_OWNER_ID,
  discardPendingForActiveOwner,
  drainQueue,
  enqueueRecord,
  listPendingForActiveOwner,
  pendingCountForActiveOwner,
  pendingCountForOtherOwners
} from './syncQueue';

const ACTIVE_KEY = 'cropcard.activeOwnerId';
const OWNERS = ['owner_home_farm', 'owner_a', 'owner_b', 'owner_c'] as const;
const KINDS: PendingRecordKind[] = [
  'herbicide',
  'insecticide',
  'fungicide',
  'harvest',
  'hay-cutting',
  'scout',
  'task'
];

/** 0 = accepted; 503 = transient (retried); 400/422 = definitive (parked). */
type FailStatus = 0 | 503 | 400 | 422;

interface Payload {
  marker: string;
  fail: FailStatus;
}

interface SeedRow {
  ownerId: string | undefined;
  kind: PendingRecordKind | undefined;
  createdAt: number;
  fail: FailStatus;
}

const ownerTagArb: fc.Arbitrary<string | undefined> = fc.oneof(
  { weight: 8, arbitrary: fc.constantFrom<string>(...OWNERS) },
  { weight: 1, arbitrary: fc.constantFrom<string | undefined>(undefined, UNASSIGNED_OWNER_ID) }
);

function failArb(): fc.Arbitrary<FailStatus> {
  return fc.constantFrom<FailStatus>(0, 0, 503, 400, 422);
}

const seedRowArb: fc.Arbitrary<SeedRow> = fc.record({
  ownerId: ownerTagArb,
  kind: fc.option(fc.constantFrom(...KINDS), { nil: undefined }),
  createdAt: fc.integer({ min: 0, max: 1_000_000 }),
  fail: failArb()
});

const activeOwnerArb: fc.Arbitrary<string | null> = fc.option(fc.constantFrom<string>(...OWNERS), {
  nil: null,
  freq: 4
});

function setActive(ownerId: string | null): void {
  if (ownerId === null) sessionStorage.removeItem(ACTIVE_KEY);
  else sessionStorage.setItem(ACTIVE_KEY, ownerId);
}

async function freshQueue(): Promise<void> {
  await db().pendingSprayRecords.clear();
  sessionStorage.clear();
}

async function seed(rows: SeedRow[]): Promise<PendingSprayRecord[]> {
  const recs = rows.map((r, i) => {
    const id = `row_${i}`;
    const payload: Payload = { marker: id, fail: r.fail };
    const rec: PendingSprayRecord = {
      id,
      ownerId: r.ownerId as string,
      kind: r.kind,
      occurredAt: r.createdAt,
      payload,
      attempts: 0,
      createdAt: r.createdAt
    };
    if (r.ownerId === undefined) delete (rec as Partial<PendingSprayRecord>).ownerId;
    if (r.kind === undefined) delete rec.kind;
    return rec;
  });
  await db().pendingSprayRecords.bulkPut(recs);
  return recs;
}

async function snapshot(): Promise<Map<string, PendingSprayRecord>> {
  const all = await db().pendingSprayRecords.toArray();
  return new Map(all.map((r) => [r.id, r]));
}

interface FetchCall {
  url: string;
  payload: Payload;
}

/** Fake server whose session Owner is `serverOwner()` (defaults to the
 *  tab's own id, i.e. no stale tab). It enforces the expected-owner guard
 *  the way hooks.server.ts does. */
function installFetch(
  serverOwner: () => string | null = () => sessionStorage.getItem(ACTIVE_KEY)
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const owner = serverOwner();
      if (url === ACTIVE_OWNER_ENDPOINT) {
        return owner
          ? {
              ok: true,
              status: 200,
              headers: new Headers({ 'x-cropcard-owner': owner }),
              json: async () => ({ activeOwnerId: owner })
            }
          : { ok: false, status: 401, headers: new Headers(), json: async () => ({}) };
      }
      const expected = (init.headers as Record<string, string>)[EXPECTED_OWNER_HEADER];
      if (expected !== owner) {
        return {
          ok: false,
          status: 409,
          text: async (): Promise<string> => '{"code":"OWNER_MISMATCH"}'
        };
      }
      const payload = JSON.parse(String(init.body)) as Payload;
      calls.push({ url, payload });
      return payload.fail
        ? {
            ok: false,
            status: payload.fail,
            text: async (): Promise<string> => 'rejected',
            json: async () => ({})
          }
        : {
            ok: true,
            status: 200,
            text: async (): Promise<string> => '{}',
            json: async () => ({ ok: true })
          };
    })
  );
  return calls;
}

function kindOfSeed(r: { kind?: PendingRecordKind }): PendingRecordKind {
  return r.kind ?? 'herbicide';
}

beforeEach(async () => {
  await freshQueue();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('#278 — offline queue never crosses tenants (fake-indexeddb)', () => {
  it('listPendingForActiveOwner returns exactly the active owner’s rows, oldest first', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(seedRowArb, { maxLength: 30 }),
        activeOwnerArb,
        async (rows, active) => {
          await freshQueue();
          const recs = await seed(rows);
          setActive(active);

          const listed = await listPendingForActiveOwner();
          const expected = active === null ? [] : recs.filter((r) => r.ownerId === active);

          expect(listed.every((r) => r.ownerId === active)).toBe(true);
          expect(new Set(listed.map((r) => r.id))).toEqual(new Set(expected.map((r) => r.id)));
          for (let i = 1; i < listed.length; i++) {
            expect(listed[i].createdAt).toBeGreaterThanOrEqual(listed[i - 1].createdAt);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('active + other-owner counts partition the queue (untagged rows surface as other)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(seedRowArb, { maxLength: 30 }),
        activeOwnerArb,
        async (rows, active) => {
          await freshQueue();
          const recs = await seed(rows);
          setActive(active);

          const mine = await pendingCountForActiveOwner();
          const others = await pendingCountForOtherOwners();
          if (active === null) {
            expect(mine).toBe(0);
            expect(others).toBe(0);
            return;
          }
          expect(mine).toBe(recs.filter((r) => r.ownerId === active).length);
          expect(others).toBe(recs.filter((r) => r.ownerId !== active).length);
          expect(mine + others).toBe(recs.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('discardPendingForActiveOwner refuses (and preserves) every foreign row', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(seedRowArb, { minLength: 1, maxLength: 20 }),
        activeOwnerArb,
        fc.array(fc.nat(), { maxLength: 20 }),
        async (rows, active, picks) => {
          await freshQueue();
          const recs = await seed(rows);
          setActive(active);
          const before = await snapshot();

          const targets = [...picks.map((p) => recs[p % recs.length].id), 'row_missing'];
          const discarded = new Set<string>();
          for (const id of targets) {
            const row = before.get(id);
            const ok = await discardPendingForActiveOwner(id);
            const shouldDelete =
              active !== null && row !== undefined && row.ownerId === active && !discarded.has(id);
            expect(ok).toBe(shouldDelete);
            if (ok) discarded.add(id);
          }

          const after = await snapshot();
          for (const [id, row] of before) {
            if (row.ownerId !== active || active === null) {
              expect(after.get(id)).toEqual(row);
            }
          }
          for (const id of discarded) expect(after.has(id)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('drainQueue only POSTs the active owner’s rows, to the kind’s endpoint, and never touches foreign rows', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(seedRowArb, { maxLength: 30 }),
        activeOwnerArb,
        async (rows, active) => {
          await freshQueue();
          const recs = await seed(rows);
          setActive(active);
          const before = await snapshot();
          const calls = installFetch();

          const result = await drainQueue();
          const after = await snapshot();

          if (active === null) {
            expect(calls).toHaveLength(0);
            expect(result.halted).toBe('no-active-owner');
            expect(result.succeeded).toHaveLength(0);
            expect(after).toEqual(before);
            return;
          }

          const mine = recs.filter((r) => r.ownerId === active);
          const foreign = recs.filter((r) => r.ownerId !== active);
          const byId = new Map(recs.map((r) => [r.id, r]));

          expect(result.skippedOtherOwner).toBe(foreign.length);
          expect(calls).toHaveLength(mine.length);
          for (const call of calls) {
            const src = byId.get(call.payload.marker);
            expect(src?.ownerId).toBe(active);
            expect(call.url).toBe(ENDPOINT_BY_KIND[kindOfSeed(src!)]);
          }
          expect(
            new Set([
              ...result.succeeded,
              ...result.failed.map((f) => f.id),
              ...result.rejected.map((f) => f.id)
            ])
          ).toEqual(new Set(mine.map((r) => r.id)));

          for (const r of foreign) expect(after.get(r.id)).toEqual(before.get(r.id));
          for (const r of mine) {
            const p = r.payload as Payload;
            if (p.fail) {
              expect(after.get(r.id)?.ownerId).toBe(active);
              expect(after.get(r.id)?.attempts).toBe(1);
              expect(after.get(r.id)?.status).toBe(p.fail === 503 ? undefined : 'rejected');
            } else {
              expect(after.has(r.id)).toBe(false);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rows enqueued with no active owner are tagged unassigned and never drain under any owner', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...KINDS), { minLength: 1, maxLength: 8 }),
        fc.constantFrom<string>(...OWNERS),
        async (kinds, laterOwner) => {
          await freshQueue();
          setActive(null);
          const ids: string[] = [];
          for (const k of kinds) ids.push(await enqueueRecord(k, { marker: k, fail: 0 }));

          const stored = await db().pendingSprayRecords.bulkGet(ids);
          expect(stored.every((r) => r?.ownerId === UNASSIGNED_OWNER_ID)).toBe(true);

          const calls = installFetch();
          expect((await drainQueue()).succeeded).toHaveLength(0);

          setActive(laterOwner);
          expect(await listPendingForActiveOwner()).toHaveLength(0);
          const result = await drainQueue();
          expect(result.succeeded).toHaveLength(0);
          expect(result.skippedOtherOwner).toBe(ids.length);
          expect(await pendingCountForOtherOwners()).toBe(ids.length);
          for (const id of ids) expect(await discardPendingForActiveOwner(id)).toBe(false);
          expect(calls).toHaveLength(0);
          expect(await db().pendingSprayRecords.count()).toBe(ids.length);
        }
      ),
      { numRuns: 50 }
    );
  });

  type Op =
    | { t: 'switch'; owner: string | null }
    | { t: 'enqueue'; kind: PendingRecordKind; fail: FailStatus }
    | { t: 'drain' }
    | { t: 'discard'; pick: number }
    | { t: 'list' };

  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ t: fc.constant('switch' as const), owner: activeOwnerArb }),
    fc.record({
      t: fc.constant('enqueue' as const),
      kind: fc.constantFrom(...KINDS),
      fail: failArb()
    }),
    fc.record({ t: fc.constant('drain' as const) }),
    fc.record({ t: fc.constant('discard' as const), pick: fc.nat() }),
    fc.record({ t: fc.constant('list' as const) })
  );

  it('model check: arbitrary switch/enqueue/drain/discard/list interleavings stay owner-scoped', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { maxLength: 40 }), async (ops) => {
        await freshQueue();
        const calls = installFetch();
        const model = new Map<
          string,
          { ownerId: string; kind: PendingRecordKind; marker: string; rejected: boolean }
        >();
        const everEnqueued: string[] = [];
        let active: string | null = null;
        let seq = 0;

        for (const op of ops) {
          if (op.t === 'switch') {
            active = op.owner;
            setActive(active);
          } else if (op.t === 'enqueue') {
            const marker = `m${seq++}`;
            const id = await enqueueRecord(op.kind, { marker, fail: op.fail });
            model.set(id, {
              ownerId: active ?? UNASSIGNED_OWNER_ID,
              kind: op.kind,
              marker,
              rejected: false
            });
            everEnqueued.push(id);
          } else if (op.t === 'drain') {
            const callsBefore = calls.length;
            const result = await drainQueue();
            const newCalls = calls.slice(callsBefore);
            if (active === null) {
              expect(newCalls).toHaveLength(0);
              continue;
            }
            const mine = [...model].filter(([, m]) => m.ownerId === active);
            const live = mine.filter(([, m]) => !m.rejected);
            expect(result.skippedOtherOwner).toBe(model.size - mine.length);
            expect(result.skippedRejected).toBe(mine.length - live.length);
            expect(newCalls).toHaveLength(live.length);
            for (const c of newCalls) {
              const entry = [...model].find(([, m]) => m.marker === c.payload.marker);
              expect(entry?.[1].ownerId).toBe(active);
              expect(c.url).toBe(ENDPOINT_BY_KIND[entry![1].kind]);
            }
            for (const id of result.succeeded) model.delete(id);
            for (const { id } of result.rejected) model.get(id)!.rejected = true;
          } else if (op.t === 'discard') {
            if (everEnqueued.length === 0) continue;
            const id = everEnqueued[op.pick % everEnqueued.length];
            const row = model.get(id);
            const ok = await discardPendingForActiveOwner(id);
            expect(ok).toBe(active !== null && row !== undefined && row.ownerId === active);
            if (ok) model.delete(id);
          } else {
            const listed = await listPendingForActiveOwner();
            const expected =
              active === null ? [] : [...model].filter(([, m]) => m.ownerId === active);
            expect(new Set(listed.map((r) => r.id))).toEqual(new Set(expected.map(([id]) => id)));
          }

          const stored = await snapshot();
          expect(new Set(stored.keys())).toEqual(new Set(model.keys()));
          for (const [id, m] of model) expect(stored.get(id)?.ownerId).toBe(m.ownerId);
        }
      }),
      { numRuns: 60 }
    );
  });
});
