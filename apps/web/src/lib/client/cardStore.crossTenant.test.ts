/**
 * Phase 30 — cross-tenant property test for the offline Card store (Dexie
 * v4), mirroring `syncQueue.crossTenant.test.ts`: for arbitrary interleavings
 * of saves, pins and unpins across Owners, the active Owner only ever reads
 * its own snapshot and pins, and an unknown Owner reads and writes nothing.
 */

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { db } from './dexie';
import {
  activeCardOwnerId,
  clearCardCaches,
  isPinned,
  listPinned,
  loadSnapshot,
  pinCard,
  saveSnapshot,
  unpinCard
} from './cardStore';
import { resetTenantCaches, syncServiceWorkerTenant, wipeTenantCaches } from './tenantSwitch';
import { OfflineCards } from '$lib/components/cards/offlineCards.svelte';
import { UNASSIGNED_OWNER_ID } from './syncQueue';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import {
  listSavedRecordCards,
  openRecordCard,
  pinRecordCard,
  saveRecordCard,
  unpinRecordCard
} from './recordCardStore';
import { recordCardKey, type CardModel } from '$lib/cards/model';
import type { SavedRecordCard } from '$lib/cards/recordCard';

const ACTIVE_KEY = 'cropcard.activeOwnerId';
const OWNERS = ['owner_home_farm', 'owner_a', 'owner_b', 'owner_c'] as const;
type Owner = (typeof OWNERS)[number];

function setActive(ownerId: string | null): void {
  if (ownerId === null) sessionStorage.removeItem(ACTIVE_KEY);
  else sessionStorage.setItem(ACTIVE_KEY, ownerId);
}

async function fresh(): Promise<void> {
  await clearCardCaches();
  sessionStorage.clear();
}

type Op =
  | { t: 'save'; as: Owner; bundleOwner: Owner; etag: string }
  | { t: 'pin'; as: Owner | null; key: string; at: number }
  | { t: 'unpin'; as: Owner | null; key: string };

const ownerArb = fc.constantFrom<Owner>(...OWNERS);
const keyArb = fc.constantFrom('pl_1', 'pl_2', 'ar_1', 'ar_2', 'sp_9');
const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    t: fc.constant('save' as const),
    as: ownerArb,
    bundleOwner: ownerArb,
    etag: fc.string({ maxLength: 6 })
  }),
  fc.record({
    t: fc.constant('pin' as const),
    as: fc.option(ownerArb, { nil: null }),
    key: keyArb,
    at: fc.integer({ min: 0, max: 1_000_000 })
  }),
  fc.record({
    t: fc.constant('unpin' as const),
    as: fc.option(ownerArb, { nil: null }),
    key: keyArb
  })
);

describe('cardStore — cross-tenant isolation (Invariant 6, client)', () => {
  beforeEach(fresh);
  afterEach(fresh);

  it('an Owner never reads another Owner’s snapshot or pins', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { maxLength: 30 }), ownerArb, async (ops, reader) => {
        await fresh();
        const expectedSnap = new Map<Owner, string>();
        const expectedPins = new Map<Owner, Map<string, number>>();
        for (const op of ops) {
          setActive(op.as);
          if (op.t === 'save') {
            const ok = await saveSnapshot(sampleSnapshot({ ownerId: op.bundleOwner }), op.etag, 1);
            expect(ok).toBe(op.as === op.bundleOwner);
            if (ok) expectedSnap.set(op.as, op.etag);
          } else if (op.t === 'pin') {
            const ok = await pinCard(op.key, op.at);
            expect(ok).toBe(op.as !== null);
            if (op.as) {
              const m = expectedPins.get(op.as) ?? new Map<string, number>();
              m.set(op.key, op.at);
              expectedPins.set(op.as, m);
            }
          } else {
            await unpinCard(op.key);
            if (op.as) expectedPins.get(op.as)?.delete(op.key);
          }
        }

        setActive(reader);
        const snap = await loadSnapshot();
        if (expectedSnap.has(reader)) {
          expect(snap?.ownerId).toBe(reader);
          expect(snap?.bundle.ownerId).toBe(reader);
          expect(snap?.etag).toBe(expectedSnap.get(reader));
        } else {
          expect(snap).toBeNull();
        }

        const pins = await listPinned();
        expect(pins.every((p) => p.ownerId === reader)).toBe(true);
        const want = expectedPins.get(reader) ?? new Map();
        expect(new Set(pins.map((p) => p.key))).toEqual(new Set(want.keys()));
        for (let i = 1; i < pins.length; i++) {
          expect(pins[i - 1].pinnedAt).toBeGreaterThanOrEqual(pins[i].pinnedAt);
        }
        for (const key of ['pl_1', 'ar_2']) {
          expect(await isPinned(key)).toBe(want.has(key));
        }
      }),
      { numRuns: 60 }
    );
  });

  it('an unknown or sentinel Owner reads nothing and writes nothing', async () => {
    setActive('owner_a');
    await saveSnapshot(sampleSnapshot({ ownerId: 'owner_a' }), 'e1');
    await pinCard('pl_1');
    for (const active of [null, UNASSIGNED_OWNER_ID, '', ' owner_a']) {
      setActive(active);
      expect(activeCardOwnerId()).toBeNull();
      expect(await loadSnapshot()).toBeNull();
      expect(await listPinned()).toEqual([]);
      expect(await isPinned('pl_1')).toBe(false);
      expect(await saveSnapshot(sampleSnapshot({ ownerId: 'owner_a' }), 'e2')).toBe(false);
      expect(await pinCard('pl_2')).toBe(false);
      expect(await unpinCard('pl_1')).toBe(false);
    }
    setActive('owner_a');
    expect((await loadSnapshot())?.etag).toBe('e1');
    expect((await listPinned()).map((p) => p.key)).toEqual(['pl_1']);
  });

  it('never returns a row whose bundle names another Owner', async () => {
    await db().farmSnapshots.put({
      ownerId: 'owner_a',
      etag: 'x',
      fetchedAt: 1,
      bundle: sampleSnapshot({ ownerId: 'owner_b' })
    });
    setActive('owner_a');
    expect(await loadSnapshot()).toBeNull();
  });

  it('resetTenantCaches and wipeTenantCaches clear both Card tables and keep the queue', async () => {
    await db().pendingSprayRecords.put({
      id: 'q1',
      ownerId: 'owner_a',
      kind: 'herbicide',
      occurredAt: 1,
      payload: {},
      attempts: 0,
      createdAt: 1
    });
    for (const reset of [() => resetTenantCaches('owner_b'), () => wipeTenantCaches()]) {
      setActive('owner_a');
      await saveSnapshot(sampleSnapshot({ ownerId: 'owner_a' }), 'e');
      await pinCard('pl_1');
      setActive('owner_b');
      await saveSnapshot(sampleSnapshot({ ownerId: 'owner_b' }), 'e');
      await pinCard('pl_2');
      await saveRecordCard(recordModel('spray', 'b1'));
      await pinRecordCard(recordCardKey('spray', 'b1'));
      await reset();
      expect(await db().farmSnapshots.count()).toBe(0);
      expect(await db().pinnedCards.count()).toBe(0);
      expect(await db().recordCards.count()).toBe(0);
      expect(await db().pendingSprayRecords.get('q1')).toBeDefined();
    }
    await db().pendingSprayRecords.clear();
  });

  it('a signed-in session with no active Owner (revoked helper) reads nothing from the old farm', async () => {
    setActive('owner_a');
    await saveSnapshot(sampleSnapshot({ ownerId: 'owner_a' }), 'e');
    await pinCard('pl_1');

    const cards = new OfflineCards();
    const stop = cards.start(null);
    await expect.poll(() => cards.loaded).toBe(true);
    stop();
    expect(cards.row).toBeNull();
    expect(cards.pinned).toEqual([]);
    expect(sessionStorage.getItem(ACTIVE_KEY)).toBeNull();
    expect(await loadSnapshot()).toBeNull();
    expect(await db().farmSnapshots.count()).toBe(0);

    setActive('owner_a');
    await saveSnapshot(sampleSnapshot({ ownerId: 'owner_a' }), 'e');
    await syncServiceWorkerTenant({ register: false, signedIn: true, ownerId: null });
    expect(sessionStorage.getItem(ACTIVE_KEY)).toBeNull();
    expect(await db().farmSnapshots.count()).toBe(0);
  });
});

function recordModel(recordKind: string, rowId: string, owner = 'x'): SavedRecordCard {
  const card = {
    kind: 'spray',
    key: recordCardKey(recordKind, rowId),
    kicker: 'Spray record',
    title: `${owner} ${rowId}`,
    facts: [],
    sections: [],
    asOf: 1,
    provenance: [],
    href: `/records/${recordKind}/${rowId}`
  } as CardModel;
  return { v: 1, recordKind, rowId, cards: [card], origin: null };
}

type RecordOp =
  | { t: 'save'; as: Owner | null; row: string; at: number }
  | { t: 'pin'; as: Owner | null; row: string; at: number }
  | { t: 'unpin'; as: Owner | null; row: string }
  | { t: 'open'; as: Owner | null; row: string; at: number };

const rowArb = fc.constantFrom('r1', 'r2', 'r3', 'r4');
const asArb = fc.option(ownerArb, { nil: null });
const recordOpArb: fc.Arbitrary<RecordOp> = fc.oneof(
  fc.record({
    t: fc.constant('save' as const),
    as: asArb,
    row: rowArb,
    at: fc.integer({ min: 0, max: 1_000_000 })
  }),
  fc.record({
    t: fc.constant('pin' as const),
    as: asArb,
    row: rowArb,
    at: fc.integer({ min: 0, max: 1_000_000 })
  }),
  fc.record({ t: fc.constant('unpin' as const), as: asArb, row: rowArb }),
  fc.record({
    t: fc.constant('open' as const),
    as: asArb,
    row: rowArb,
    at: fc.integer({ min: 0, max: 1_000_000 })
  })
);

describe('recordCardStore — cross-tenant isolation (33D, Invariant 6, client)', () => {
  beforeEach(fresh);
  afterEach(fresh);

  it('an Owner never reads another Owner’s saved record cards or record pins', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(recordOpArb, { maxLength: 30 }), ownerArb, async (ops, reader) => {
        await fresh();
        const saved = new Map<Owner, Set<string>>();
        const pins = new Map<Owner, Set<string>>();
        for (const op of ops) {
          setActive(op.as);
          const key = recordCardKey('spray', op.row);
          if (op.t === 'save') {
            const ok = await saveRecordCard(recordModel('spray', op.row, op.as ?? 'none'), op.at);
            expect(ok).toBe(op.as !== null);
            if (op.as) saved.set(op.as, (saved.get(op.as) ?? new Set()).add(op.row));
          } else if (op.t === 'pin') {
            const outcome = await pinRecordCard(key, op.at);
            if (!op.as) {
              expect(outcome).toBe('no-owner');
            } else if (saved.get(op.as)?.has(op.row)) {
              expect(outcome).toBe('pinned');
              pins.set(op.as, (pins.get(op.as) ?? new Set()).add(op.row));
            } else {
              expect(outcome).toBe('missing');
            }
          } else if (op.t === 'unpin') {
            await unpinRecordCard(key);
            if (op.as) pins.get(op.as)?.delete(op.row);
          } else {
            const opened = await openRecordCard(key, op.at);
            if (!op.as) expect(opened).toBeNull();
            else {
              expect(opened !== null).toBe(saved.get(op.as)?.has(op.row) ?? false);
              if (opened) expect(opened.model.cards[0].title).toBe(`${op.as} ${op.row}`);
            }
          }
        }

        setActive(reader);
        const { pinned, recent } = await listSavedRecordCards();
        const all = [...pinned, ...recent];
        expect(all.every((r) => r.ownerId === reader)).toBe(true);
        expect(all.every((r) => r.model.cards[0].title.startsWith(`${reader} `))).toBe(true);
        expect(new Set(all.map((r) => r.model.rowId))).toEqual(saved.get(reader) ?? new Set());
        expect(new Set(pinned.map((r) => r.model.rowId))).toEqual(pins.get(reader) ?? new Set());
        for (const row of ['r1', 'r2']) {
          const opened = await openRecordCard(recordCardKey('spray', row));
          expect(opened !== null).toBe(saved.get(reader)?.has(row) ?? false);
        }
      }),
      { numRuns: 60 }
    );
  });

  it('an Owner switch drops every saved record card and pin', async () => {
    setActive('owner_a');
    await saveRecordCard(recordModel('spray', 'r1', 'owner_a'));
    await pinRecordCard(recordCardKey('spray', 'r1'));
    await resetTenantCaches('owner_b');
    expect(await db().recordCards.count()).toBe(0);
    setActive('owner_a');
    expect(await openRecordCard(recordCardKey('spray', 'r1'))).toBeNull();
    expect(await listSavedRecordCards()).toEqual({ pinned: [], recent: [] });
  });
});
