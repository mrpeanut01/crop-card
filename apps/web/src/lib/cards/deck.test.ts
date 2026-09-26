import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DECK_FILTERS, filterDeck, isDeckFilter, orderDeck } from './deck';
import { buildDeck } from './build';
import { sampleGearSnapshot } from './build/fixturesGear';

const deck = buildDeck(sampleGearSnapshot());
const keys = deck.map((c) => c.key);

describe('deck filters', () => {
  it('offers the design filters in order', () => {
    expect(DECK_FILTERS.map((f) => f.label)).toEqual([
      'All',
      'Pinned',
      'Today',
      'Plantings',
      'Areas',
      'Equipment',
      'Spray',
      'Care guides'
    ]);
    expect(isDeckFilter('spray')).toBe(true);
    expect(isDeckFilter('stock')).toBe(false);
  });

  it('kind filters keep only that kind (Areas also holds the farm map); Today keeps day cards', () => {
    for (const f of ['planting', 'area', 'equipment', 'spray', 'careGuide'] as const) {
      const out = filterDeck(deck, f, []);
      expect(out.length).toBeGreaterThan(0);
      const allowed = f === 'area' ? ['area', 'farmMap'] : [f];
      expect(out.every((c) => allowed.includes(c.kind))).toBe(true);
    }
    expect(filterDeck(deck, 'area', []).some((c) => c.kind === 'farmMap')).toBe(true);
    expect(filterDeck(deck, 'today', []).every((c) => c.kind === 'day')).toBe(true);
  });

  it('pins come first, newest pin first, and the Pinned filter shows only them', () => {
    const pinned = [keys[5], keys[2]];
    expect(
      orderDeck(deck, pinned)
        .slice(0, 2)
        .map((c) => c.key)
    ).toEqual(pinned);
    expect(filterDeck(deck, 'pinned', pinned).map((c) => c.key)).toEqual(pinned);
  });

  it('property: ordering is a permutation for any set of pins, including stale ones', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.oneof(fc.constantFrom(...keys), fc.string({ maxLength: 6 }))),
        (pinned) => {
          const out = orderDeck(deck, pinned);
          expect(out.map((c) => c.key).sort()).toEqual([...keys].sort());
          expect(filterDeck(deck, 'all', pinned)).toEqual(out);
        }
      )
    );
  });
});
