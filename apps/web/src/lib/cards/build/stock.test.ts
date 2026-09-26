import { describe, expect, it } from 'vitest';
import { buildStockCard, buildStockCards, isLowStock } from './stock';
import { sampleGearSnapshot } from './fixturesGear';

describe('buildStockCard', () => {
  const snap = sampleGearSnapshot();

  it('seed: on hand, reorder point, expiry, low flag and the plantings it is for', () => {
    const card = buildStockCard(snap, 's_bean')!;
    expect(card.kind).toBe('stock');
    expect(card.key).toBe('st_s_bean');
    expect(card.kicker).toBe('Stock · Seed');
    expect(card.facts).toEqual([
      { label: 'On hand', value: '1 lb', provenance: 'data' },
      { label: 'Reorder at', value: '2 lb', provenance: 'manual' },
      { label: 'Expires', value: 'Jun 20, soon', provenance: 'manual' },
      { label: 'Status', value: 'Low, reorder', provenance: 'data' }
    ]);
    expect(card.sections).toEqual([
      { title: 'Planned for', items: ['Provider bush bean · Bed 1 · Jun 10'] }
    ]);
    expect(card.next).toEqual({ label: 'Open in inventory', href: '/inventory/seed/s_bean' });
  });

  it('pesticide: links to the pesticide inventory detail and is not low without a threshold', () => {
    const card = buildStockCard(snap, 's_24d')!;
    expect(card.facts).toEqual([{ label: 'On hand', value: '2.5 gal', provenance: 'data' }]);
    expect(card.next?.href).toBe('/inventory/pesticide/s_24d');
  });

  it('marks an expired lot', () => {
    const card = buildStockCard(snap, 's_bean', { now: Date.parse('2026-07-01T12:00:00Z') })!;
    expect(card.facts.find((f) => f.label === 'Expires')?.value).toBe('Jun 20, expired');
  });

  it('isLowStock needs a threshold', () => {
    expect(isLowStock({ onHand: 0, reorderThreshold: null })).toBe(false);
    expect(isLowStock({ onHand: 2, reorderThreshold: 2 })).toBe(true);
  });

  it('sorts the deck by name and returns null for unknown ids', () => {
    expect(buildStockCards(snap).map((c) => c.title)).toEqual([
      '2,4-D Amine',
      'Provider bean seed'
    ]);
    expect(buildStockCard(snap, 'nope')).toBeNull();
  });
});
