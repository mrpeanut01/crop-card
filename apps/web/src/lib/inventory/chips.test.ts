import { describe, expect, it } from 'vitest';
import { visibleInventoryTypes } from './chips';

const CROP_ONLY = ['pesticide', 'fertility', 'seed', 'crop'];

describe('visibleInventoryTypes', () => {
  it('hides feed and animal-health on a crop-only farm', () => {
    expect(visibleInventoryTypes({ stockCounts: {}, hasAnimals: false })).toEqual(CROP_ONLY);
  });

  it('shows both animal chips once the farm has animals', () => {
    expect(visibleInventoryTypes({ stockCounts: {}, hasAnimals: true })).toEqual([
      ...CROP_ONLY,
      'feed',
      'animal-health'
    ]);
  });

  it('shows only the animal type that has stock', () => {
    expect(visibleInventoryTypes({ stockCounts: { feed: 2 }, hasAnimals: false })).toEqual([
      ...CROP_ONLY,
      'feed'
    ]);
    expect(
      visibleInventoryTypes({ stockCounts: { 'animal-health': 1 }, hasAnimals: false })
    ).toEqual([...CROP_ONLY, 'animal-health']);
  });

  it('keeps the active type visible even when empty', () => {
    expect(
      visibleInventoryTypes({ stockCounts: {}, hasAnimals: false, active: 'animal-health' })
    ).toEqual([...CROP_ONLY, 'animal-health']);
  });

  it('never hides a crop-side type, even at zero', () => {
    const out = visibleInventoryTypes({
      stockCounts: { pesticide: 0, fertility: 0, seed: 0 },
      hasAnimals: false
    });
    expect(out).toEqual(CROP_ONLY);
  });
});
