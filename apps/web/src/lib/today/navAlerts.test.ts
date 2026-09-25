import { describe, it, expect } from 'vitest';
import { buildNavAlerts } from './navAlerts';

const EMPTY = { dirtySprayers: [], winterize: [], lowStock: [], expiring: [] };

describe('buildNavAlerts', () => {
  it('returns nothing when there is nothing to flag', () => {
    expect(buildNavAlerts(EMPTY)).toEqual([]);
  });

  it('orders decon first and links each alert to its surface', () => {
    const out = buildNavAlerts({
      dirtySprayers: [{ id: 's 1', label: 'Rig', lastChemistryClass: 'group-9' }],
      winterize: [
        { sprayerId: 's2', label: 'Backpack', neverWinterized: true, uncalibrated: true }
      ],
      lowStock: [{ id: 'i1', displayName: 'Roundup', category: 'herbicide' }],
      expiring: [{ itemId: 'i2', itemName: 'Seed', category: 'seed', daysUntilExpiry: 1 }]
    });
    expect(out.map((a) => [a.tone, a.label, a.href])).toEqual([
      ['rust', 'Rig needs decon (group-9)', '/spray/decon?sprayer=s%201'],
      ['wheat', 'Backpack: recalibrate and check winterization', '/equipment/s2/winterize'],
      ['wheat', 'Roundup is low on stock', '/inventory/pesticide/i1'],
      ['wheat', 'Seed lot expires in 1 day', '/inventory/seed/i2']
    ]);
  });

  it('collapses multiple expiring lots of one item into a single alert', () => {
    const out = buildNavAlerts({
      ...EMPTY,
      expiring: [
        { itemId: 'i1', itemName: 'Copper', category: 'fungicide', daysUntilExpiry: 3 },
        { itemId: 'i1', itemName: 'Copper', category: 'fungicide', daysUntilExpiry: 20 }
      ]
    });
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('Copper lot expires in 3 days');
  });
});
