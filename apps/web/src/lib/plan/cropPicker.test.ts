import { describe, expect, it } from 'vitest';
import {
  amountInStockUnit,
  optionLabel,
  searchCrops,
  unitsCompatibleWith,
  type PickerCrop,
  type PickerSeed
} from './cropPicker';

const CATALOG: PickerCrop[] = [
  { pluginId: 'tomato-brandywine', displayName: 'Brandywine Tomato', cropFamily: 'solanaceae' },
  { pluginId: 'tomato-sungold', displayName: 'Sungold Tomato', cropFamily: 'solanaceae' },
  { pluginId: 'corn-silver-queen', displayName: 'Silver Queen Corn', cropFamily: 'corn' },
  { pluginId: 'garlic-music', displayName: 'Music Garlic', cropFamily: 'allium' }
];

const SEEDS: PickerSeed[] = [
  {
    stockItemId: 's1',
    displayName: 'Sweet Corn Silver Queen Treated (1 lb)',
    shortName: 'Silver Queen Corn',
    onHand: 2,
    defaultUnit: 'lb',
    cropPluginId: 'corn-silver-queen'
  },
  {
    stockItemId: 's2',
    displayName: 'Empty packet',
    onHand: 0,
    defaultUnit: 'seeds',
    cropPluginId: 'tomato-sungold'
  },
  {
    stockItemId: 's3',
    displayName: 'Mystery seed',
    onHand: 10,
    defaultUnit: 'seeds',
    cropPluginId: null
  }
];

describe('searchCrops', () => {
  it('shows only seed on hand when nothing is typed', () => {
    const r = searchCrops('', SEEDS, CATALOG);
    expect(r.seeds.map((o) => o.seed.stockItemId)).toEqual(['s1']);
    expect(r.crops).toEqual([]);
    expect(r.moreCrops).toBe(3);
  });

  it('falls back to the catalog when there is no seed on hand', () => {
    const r = searchCrops('', [], CATALOG);
    expect(r.crops).toHaveLength(4);
  });

  it('lists seed matches ahead of catalog matches and dedupes seeded crops', () => {
    const r = searchCrops('corn', SEEDS, CATALOG);
    expect(r.seeds).toHaveLength(1);
    expect(r.crops.find((o) => o.crop.pluginId === 'corn-silver-queen')).toBeUndefined();
  });

  it('matches word starts and family names', () => {
    const r = searchCrops('sol', [], CATALOG);
    expect(r.crops.map((o) => o.crop.pluginId)).toEqual(['tomato-brandywine', 'tomato-sungold']);
    const g = searchCrops('gar', [], CATALOG);
    expect(g.crops[0].crop.pluginId).toBe('garlic-music');
  });

  it('keeps empty and unlinked seed out of the seed group', () => {
    const r = searchCrops('tomato', SEEDS, CATALOG);
    expect(r.seeds).toEqual([]);
    expect(r.crops).toHaveLength(2);
  });

  it('labels a seed option by its short name', () => {
    const r = searchCrops('', SEEDS, CATALOG);
    expect(optionLabel(r.seeds[0])).toBe('Silver Queen Corn');
  });
});

describe('unit helpers', () => {
  it('offers only units that can come out of the stock', () => {
    expect(unitsCompatibleWith('lb')).toEqual(['oz', 'lb', 'g']);
    expect(unitsCompatibleWith('seeds')).toEqual(['seeds']);
  });

  it('converts a planted amount into the stock unit', () => {
    expect(amountInStockUnit(16, 'oz', 'lb')).toBeCloseTo(1);
    expect(amountInStockUnit(40, 'seeds', 'lb')).toBeNull();
  });
});
