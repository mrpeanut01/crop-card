import { describe, expect, it } from 'vitest';
import { bedMapLabels, legendText } from './bedMapLabels';
import type { CardBedMap, CardBedMapPlanting } from './model';

const planting = (over: Partial<CardBedMapPlanting>): CardBedMapPlanting => ({
  name: 'Tomato',
  glyph: 'nightshade',
  x: 0,
  y: 0,
  w: 4,
  l: 4,
  placed: true,
  later: false,
  ...over
});

const map = (plantings: CardBedMapPlanting[]): CardBedMap => ({
  widthFt: 20,
  lengthFt: 20,
  hasNorth: false,
  onMs: 0,
  beds: [{ name: 'Bed 1', kind: 'bed', x: 0, y: 0, w: 4, l: 8, crops: [], plantings }]
});

describe('bed map labels (#481)', () => {
  it('prints the name inside a spot it fits and numbers the rest', () => {
    const { labels, legend } = bedMapLabels(
      map([
        planting({ name: 'Kale', w: 4, l: 4 }),
        planting({ name: 'Cherokee Purple tomato', w: 1, l: 1 })
      ]),
      0.5
    );
    expect(labels[0][0]).toMatchObject({ text: 'Kale', n: null });
    expect(labels[0][0].iconFt).toBeGreaterThan(0);
    expect(labels[0][1]).toMatchObject({ text: null, n: 1 });
    expect(legend).toEqual([{ n: 1, text: 'Cherokee Purple tomato' }]);
  });

  it('keys later and not-yet-placed plantings in the legend with their date', () => {
    const { legend } = bedMapLabels(
      map([
        planting({ name: 'Bush bean', later: true, from: '2026-06-03' }),
        planting({ name: 'Lettuce', placed: false })
      ]),
      0.5
    );
    expect(legend).toEqual([
      { n: 1, text: 'Bush bean, from Jun 3' },
      { n: 2, text: 'Lettuce, not placed yet' }
    ]);
    expect(legendText(planting({ name: 'Beet' }))).toBe('Beet');
  });

  it('reads beds saved before plantings were added', () => {
    const old: CardBedMap = { ...map([]), beds: [{ ...map([]).beds[0], plantings: undefined }] };
    expect(bedMapLabels(old, 0.5)).toEqual({ labels: [[]], legend: [] });
  });
});
