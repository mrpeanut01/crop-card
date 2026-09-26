import { describe, expect, it } from 'vitest';
import { CARD_KINDS, RECORD_ONLY_CARD_KINDS } from '../model';
import { buildCard, buildDeck } from './index';
import { sampleGearSnapshot } from './fixturesGear';

describe('buildCard / buildDeck', () => {
  const snap = sampleGearSnapshot();
  const deck = buildDeck(snap);

  it('every deck card rebuilds from its own key alone', () => {
    expect(deck.length).toBeGreaterThan(10);
    for (const card of deck) {
      expect(buildCard(snap, card.key)).toEqual(card);
      expect(card.href).toBe(`/cards/${card.kind}/${encodeURIComponent(card.key)}`);
    }
  });

  it('covers every snapshot card kind, with exactly one farm map', () => {
    const kinds = new Set(deck.map((c) => c.kind));
    const snapshotKinds = CARD_KINDS.filter((k) => !RECORD_ONLY_CARD_KINDS.includes(k));
    expect(snapshotKinds.filter((k) => !kinds.has(k))).toEqual([]);
    expect(deck.filter((c) => RECORD_ONLY_CARD_KINDS.includes(c.kind))).toEqual([]);
    expect(deck.filter((c) => c.kind === 'farmMap')).toHaveLength(1);
  });

  it('keys are unique across the deck', () => {
    expect(new Set(deck.map((c) => c.key)).size).toBe(deck.length);
  });

  it('unknown and malformed keys build nothing', () => {
    expect(buildCard(snap, 'zz_1')).toBeNull();
    expect(buildCard(snap, 'pl_missing')).toBeNull();
    expect(buildCard(snap, 'nokey')).toBeNull();
    expect(buildCard(snap, 'sc_any')).toBeNull();
    expect(buildCard(snap, 'rc_spray.any')).toBeNull();
  });
});
