import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  longestPhiDays,
  phiDaysForCrop,
  phiDaysForCrops,
  type PhiByCropEntry,
  type PhiProduct
} from './preHarvestInterval';

const CROPS = ['corn', 'wheat', 'soybean', 'tomato'] as const;
const FAMILIES = ['grass-cereal', 'legume', 'solanaceae'] as const;

const entryArb: fc.Arbitrary<PhiByCropEntry> = fc.oneof(
  fc.record({
    cropPluginId: fc.constantFrom(...CROPS),
    preHarvestIntervalDays: fc.integer({ min: 0, max: 120 })
  }),
  fc.record({
    cropFamily: fc.constantFrom(...FAMILIES),
    preHarvestIntervalDays: fc.integer({ min: 0, max: 120 })
  })
);

const productArb: fc.Arbitrary<PhiProduct> = fc.record(
  {
    preHarvestIntervalDays: fc.integer({ min: 0, max: 120 }),
    preHarvestIntervalsByCrop: fc.array(entryArb, { maxLength: 6 })
  },
  { requiredKeys: [] }
);

const cropArb = fc.record(
  {
    cropPluginId: fc.constantFrom(...CROPS, 'unlisted-crop'),
    family: fc.constantFrom(...FAMILIES, 'brassica')
  },
  { requiredKeys: [] }
);

describe('phiDaysForCrop (#661)', () => {
  it('uses the single value when there is no by-crop table', () => {
    expect(phiDaysForCrop({ preHarvestIntervalDays: 1 }, { cropPluginId: 'corn' })).toEqual({
      days: 1,
      basis: 'single'
    });
    expect(phiDaysForCrop({}, { cropPluginId: 'corn' })).toEqual({ days: null, basis: 'none' });
  });

  it('prefers the crop entry, then the family entry', () => {
    const p: PhiProduct = {
      preHarvestIntervalDays: 1,
      preHarvestIntervalsByCrop: [
        { cropPluginId: 'corn', preHarvestIntervalDays: 21 },
        { cropFamily: 'grass-cereal', preHarvestIntervalDays: 30 }
      ]
    };
    expect(phiDaysForCrop(p, { cropPluginId: 'corn', family: 'grass-cereal' })).toEqual({
      days: 21,
      basis: 'crop'
    });
    expect(phiDaysForCrop(p, { cropPluginId: 'wheat', family: 'grass-cereal' })).toEqual({
      days: 30,
      basis: 'family'
    });
  });

  it('gives an unlisted or unknown crop the longest value on file, never the shortest', () => {
    const p: PhiProduct = {
      preHarvestIntervalDays: 1,
      preHarvestIntervalsByCrop: [
        { cropPluginId: 'tomato', preHarvestIntervalDays: 5 },
        { cropPluginId: 'corn', preHarvestIntervalDays: 21 }
      ]
    };
    expect(phiDaysForCrop(p, { cropPluginId: 'wheat' })).toEqual({ days: 21, basis: 'longest' });
    expect(phiDaysForCrop(p, null)).toEqual({ days: 21, basis: 'longest' });
    expect(phiDaysForCrops(p, [])).toBe(21);
    expect(phiDaysForCrops(p, [{ cropPluginId: 'tomato' }, { cropPluginId: 'corn' }])).toBe(21);
  });

  it('property: a crop the table does not name is never given less than any value on file', () => {
    fc.assert(
      fc.property(productArb, cropArb, (p, crop) => {
        const r = phiDaysForCrop(p, crop);
        const table = p.preHarvestIntervalsByCrop ?? [];
        const named =
          (crop.cropPluginId !== undefined &&
            table.some((e) => e.cropPluginId === crop.cropPluginId)) ||
          (crop.family !== undefined && table.some((e) => e.cropFamily === crop.family));
        if (table.length > 0 && !named) {
          expect(r.basis).toBe('longest');
          for (const e of table) expect(r.days!).toBeGreaterThanOrEqual(e.preHarvestIntervalDays);
          if (typeof p.preHarvestIntervalDays === 'number') {
            expect(r.days!).toBeGreaterThanOrEqual(p.preHarvestIntervalDays);
          }
        }
      })
    );
  });

  it('property: a named crop gets the longest of its own entries', () => {
    fc.assert(
      fc.property(productArb, cropArb, (p, crop) => {
        const r = phiDaysForCrop(p, crop);
        const own = (p.preHarvestIntervalsByCrop ?? []).filter(
          (e) => crop.cropPluginId !== undefined && e.cropPluginId === crop.cropPluginId
        );
        if (own.length > 0) {
          expect(r).toEqual({
            days: Math.max(...own.map((e) => e.preHarvestIntervalDays)),
            basis: 'crop'
          });
        }
      })
    );
  });

  it('property: the result never exceeds the longest value on file', () => {
    fc.assert(
      fc.property(productArb, cropArb, (p, crop) => {
        const r = phiDaysForCrop(p, crop);
        const longest = longestPhiDays(p);
        if (longest === null) expect(r.days).toBeNull();
        else expect(r.days!).toBeLessThanOrEqual(longest);
      })
    );
  });

  it('property: several crops get at least each crop alone', () => {
    fc.assert(
      fc.property(productArb, fc.array(cropArb, { minLength: 1, maxLength: 4 }), (p, crops) => {
        const all = phiDaysForCrops(p, crops);
        for (const c of crops) {
          const one = phiDaysForCrop(p, c).days;
          if (one !== null) expect(all!).toBeGreaterThanOrEqual(one);
        }
      })
    );
  });
});
