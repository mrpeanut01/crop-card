import { describe, expect, it } from 'vitest';
import { pastureNotice, type SprayPastureContext } from './pastureNotice';

// Test values only; none of these numbers come from a label.
const CTX: SprayPastureContext = {
  animalsByArea: {
    north: {
      areaName: 'North pasture',
      rows: [
        { label: '12 sheep (Ewes)', speciesId: 'sheep', foodProducing: true, lactating: true },
        { label: 'Rex (dog)', speciesId: 'dog', foodProducing: false, lactating: false }
      ]
    }
  },
  blockArea: { b1: 'north', b2: 'south' },
  restrictionsByPlugin: {
    known: {
      source: 't',
      grazeDays: 7,
      lactatingDairyGrazeDays: 14,
      speciesExceptions: [{ speciesId: 'dog', grazeDays: 1 }]
    },
    partial: { source: 't', grazeDays: 7 },
    banned: { source: 't', notForPasture: true },
    none: { source: 't', grazeDays: 0, lactatingDairyGrazeDays: 0 }
  }
};

const run = (blockIds: string[], products: Array<[string, string]>) =>
  pastureNotice({
    blockIds,
    products: products.map(([pluginId, name]) => ({ pluginId, name })),
    context: CTX
  });

describe('pastureNotice', () => {
  it('is null with no context or no animals on the selected blocks', () => {
    expect(pastureNotice({ blockIds: ['b1'], products: [], context: null })).toBeNull();
    expect(run(['b2'], [['known', 'K']])).toBeNull();
    expect(run([], [['known', 'K']])).toBeNull();
  });

  it('lists who is there and the longest removal', () => {
    expect(run(['b1'], [['known', 'Known Mix']])).toEqual([
      'Animals here now in North pasture: 12 sheep (Ewes), Rex (dog).',
      'Known Mix requires removal for 14 days.',
      'Move them off before you spray.'
    ]);
  });

  it.each<[string, string]>([
    [
      'unsourced',
      'The grazing interval for P is not on file. Food animals have to stay off after this spray until the owner adds it from the label.'
    ],
    [
      'partial',
      'Part of the grazing interval for P is not on file. Food animals have to stay off after this spray until the owner adds it from the label.'
    ],
    ['banned', 'The P label forbids use where animals graze.'],
    ['none', 'The P label gives no grazing interval.']
  ])('%s product', (id, line) => {
    expect(run(['b1'], [[id, 'P']])?.[1]).toBe(line);
  });

  it('asks to check the label when no product is chosen yet', () => {
    expect(run(['b1', 'b1'], [])).toEqual([
      'Animals here now in North pasture: 12 sheep (Ewes), Rex (dog).',
      'Check the label for a grazing interval before you spray.',
      'Move them off before you spray.'
    ]);
  });
});
