import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from './dexie';
import { clearCardCaches, listPinned, pinCard } from './cardStore';
import {
  RECORD_CARD_MAX_BYTES,
  RECORD_CARD_PIN_LIMIT,
  RECORD_CARD_RECENT_LIMIT,
  forgetRecordCard,
  isRecordCardPinned,
  listSavedRecordCards,
  openRecordCard,
  pinRecordCard,
  saveRecordCard,
  unpinRecordCard
} from './recordCardStore';
import { recordCardKey, type CardModel } from '$lib/cards/model';
import type { SavedRecordCard } from '$lib/cards/recordCard';

const ACTIVE_KEY = 'cropcard.activeOwnerId';

function card(rowId: string, kind = 'spray'): CardModel {
  return {
    kind: kind === 'scout' ? 'scout' : 'spray',
    key: recordCardKey(kind, rowId),
    kicker: 'Spray record',
    title: `Record ${rowId}`,
    facts: [{ label: 'Block', value: 'North', provenance: 'data' }],
    sections: [],
    asOf: 1,
    provenance: [],
    href: `/records/${kind}/${rowId}`,
    status: { label: 'Editable', tone: 'wheat' }
  } as CardModel;
}

function model(rowId: string, kind = 'spray'): SavedRecordCard {
  return { v: 1, recordKind: kind, rowId, cards: [card(rowId, kind)], origin: null };
}

const key = (rowId: string, kind = 'spray') => recordCardKey(kind, rowId);

async function fresh() {
  await clearCardCaches();
  sessionStorage.clear();
  sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
}

beforeEach(fresh);
afterEach(fresh);

describe('recordCardStore', () => {
  it('saves a card and opens it again, updating only lastOpenedAt', async () => {
    expect(await saveRecordCard(model('r1'), 100)).toBe(true);
    const opened = await openRecordCard(key('r1'), 500);
    expect(opened?.savedAt).toBe(100);
    expect(opened?.model.cards[0].title).toBe('Record r1');
    const row = await db().recordCards.get(['owner_a', key('r1')]);
    expect(row?.savedAt).toBe(100);
    expect(row?.lastOpenedAt).toBe(500);
  });

  it('never stores void rights or lock deadlines', async () => {
    const withLive = {
      ...model('r1'),
      voidableUntilMs: 5,
      canVoidHolds: true
    } as unknown as SavedRecordCard;
    await saveRecordCard(withLive, 1);
    const row = await db().recordCards.get(['owner_a', key('r1')]);
    expect(Object.keys(row?.model as object).sort()).toEqual(
      ['cards', 'origin', 'recordKind', 'rowId', 'v'].sort()
    );
  });

  it('refuses an unknown record kind, a damaged model and one over 512 KB', async () => {
    expect(await saveRecordCard(model('r1', 'bogus'))).toBe(false);
    expect(await saveRecordCard({ v: 2 } as unknown as SavedRecordCard)).toBe(false);
    const big = model('big');
    big.cards[0].facts = [
      { label: 'x', value: 'y'.repeat(RECORD_CARD_MAX_BYTES), provenance: 'data' }
    ];
    expect(await saveRecordCard(big)).toBe(false);
    expect(await db().recordCards.count()).toBe(0);
  });

  it('reads a damaged row as absent and deletes it', async () => {
    await db().recordCards.put({
      ownerId: 'owner_a',
      key: key('bad'),
      model: { v: 0 },
      savedAt: 1,
      lastOpenedAt: 1
    });
    await db().pinnedCards.put({ ownerId: 'owner_a', key: key('bad'), pinnedAt: 1 });
    expect(await openRecordCard(key('bad'))).toBeNull();
    expect(await db().recordCards.count()).toBe(0);
    expect(await db().pinnedCards.count()).toBe(0);

    await db().recordCards.put({
      ownerId: 'owner_a',
      key: key('other'),
      model: model('mismatch'),
      savedAt: 1,
      lastOpenedAt: 1
    });
    expect(await listSavedRecordCards()).toEqual({ pinned: [], recent: [] });
    expect(await db().recordCards.count()).toBe(0);
  });

  it('keeps the 50 most recently opened unpinned cards and evicts the 51st', async () => {
    for (let i = 0; i < RECORD_CARD_RECENT_LIMIT; i++) await saveRecordCard(model(`r${i}`), i + 1);
    expect(await db().recordCards.count()).toBe(RECORD_CARD_RECENT_LIMIT);
    await openRecordCard(key('r0'), 1000);
    await saveRecordCard(model('r50'), 1001);
    expect(await db().recordCards.count()).toBe(RECORD_CARD_RECENT_LIMIT);
    expect(await openRecordCard(key('r1'))).toBeNull();
    expect(await openRecordCard(key('r0'))).not.toBeNull();
    const { recent } = await listSavedRecordCards();
    expect(recent).toHaveLength(RECORD_CARD_RECENT_LIMIT);
  });

  it('never evicts a pinned card, and unpinning puts it back in the LRU', async () => {
    await saveRecordCard(model('keep'), 1);
    expect(await pinRecordCard(key('keep'), 2)).toBe('pinned');
    for (let i = 0; i < 60; i++) await saveRecordCard(model(`r${i}`), 10 + i);
    expect(await openRecordCard(key('keep'))).not.toBeNull();
    const { pinned, recent } = await listSavedRecordCards();
    expect(pinned.map((r) => r.key)).toEqual([key('keep')]);
    expect(recent).toHaveLength(RECORD_CARD_RECENT_LIMIT);

    await unpinRecordCard(key('keep'));
    expect(await isRecordCardPinned(key('keep'))).toBe(false);
    expect(await db().recordCards.count()).toBe(RECORD_CARD_RECENT_LIMIT);
  });

  it('refuses the 101st pin and needs a stored row to pin', async () => {
    expect(await pinRecordCard(key('nope'))).toBe('missing');
    expect(await pinRecordCard('pl_1')).toBe('missing');
    for (let i = 0; i < RECORD_CARD_PIN_LIMIT; i++) {
      await saveRecordCard(model(`p${i}`), i + 1);
      expect(await pinRecordCard(key(`p${i}`), i + 1)).toBe('pinned');
    }
    await pinCard('pl_1');
    await saveRecordCard(model('p100'), 500);
    expect(await pinRecordCard(key('p100'))).toBe('limit');
    expect(await isRecordCardPinned(key('p100'))).toBe(false);
    expect(await pinRecordCard(key('p0'))).toBe('pinned');
    const { pinned } = await listSavedRecordCards();
    expect(pinned).toHaveLength(RECORD_CARD_PIN_LIMIT);
    expect(pinned[0].key).toBe(key('p99'));
    await unpinRecordCard(key('p5'));
    expect(await pinRecordCard(key('p100'))).toBe('pinned');
  });

  it('forget drops the row and its pin', async () => {
    await saveRecordCard(model('r1'));
    await pinRecordCard(key('r1'));
    await forgetRecordCard(key('r1'));
    expect(await openRecordCard(key('r1'))).toBeNull();
    expect((await listPinned()).length).toBe(0);
  });

  it('with no Owner reads and writes nothing', async () => {
    await saveRecordCard(model('r1'));
    sessionStorage.removeItem(ACTIVE_KEY);
    expect(await saveRecordCard(model('r2'))).toBe(false);
    expect(await openRecordCard(key('r1'))).toBeNull();
    expect(await pinRecordCard(key('r1'))).toBe('no-owner');
    expect(await listSavedRecordCards()).toEqual({ pinned: [], recent: [] });
    expect(await db().recordCards.count()).toBe(1);
  });

  it('clearCardCaches drops saved record cards with the other card caches', async () => {
    await saveRecordCard(model('r1'));
    await pinRecordCard(key('r1'));
    await clearCardCaches();
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    expect(await db().recordCards.count()).toBe(0);
    expect(await db().pinnedCards.count()).toBe(0);
  });
});
