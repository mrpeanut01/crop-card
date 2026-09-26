import { describe, expect, it } from 'vitest';
import { CARD_KINDS } from '../model';
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

  it('covers every card kind but single tasks, with exactly one farm map', () => {
    const kinds = new Set(deck.map((c) => c.kind));
    expect(CARD_KINDS.filter((k) => !kinds.has(k))).toEqual(['task']);
    expect(deck.filter((c) => c.kind === 'farmMap')).toHaveLength(1);
  });

  it('keys are unique across the deck', () => {
    expect(new Set(deck.map((c) => c.key)).size).toBe(deck.length);
  });

  it('single task cards are built on demand from their key, never added to the deck', () => {
    const t = snap.tasks[0];
    const card = buildCard(snap, `tk_${t.id}`)!;
    expect(card.kind).toBe('task');
    expect(card.href).toBe(`/cards/task/tk_${encodeURIComponent(t.id)}`);
  });

  it('unknown and malformed keys build nothing', () => {
    expect(buildCard(snap, 'zz_1')).toBeNull();
    expect(buildCard(snap, 'pl_missing')).toBeNull();
    expect(buildCard(snap, 'nokey')).toBeNull();
  });
});
