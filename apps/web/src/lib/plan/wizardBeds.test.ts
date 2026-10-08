import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  areaFreeSqFt,
  bedAreas,
  bedTargetArea,
  bedsFit,
  nextBedNames,
  startingBedSize
} from './wizardBeds';
import { shortNameList } from './nameList';
import { DEFAULT_BED_WIDTH_FT, DEFAULT_MAX_BED_LENGTH_FT } from './bedLayout';

const SQFT = 43_560;
const field = { id: 'f1', name: 'North 40', kind: 'field', acres: 40 };
const pasture = { id: 'p1', name: 'Paddock', kind: 'pasture' };
const garden = { id: 'g1', name: 'Kitchen Garden', kind: 'garden', acres: 2_000 / SQFT };
const tunnel = { id: 'h1', name: 'High Tunnel', kind: 'greenhouse', acres: 2_880 / SQFT };

describe('#693 bed Areas', () => {
  it('a farm with only fields and pasture has no bed Area', () => {
    expect(bedAreas([field, pasture])).toEqual([]);
    expect(bedTargetArea([field, pasture], null, field)).toBeNull();
  });

  it('targets the picked bed Area, then the wizard Area if it takes beds, then the first', () => {
    const areas = [field, garden, tunnel];
    expect(bedTargetArea(areas, 'h1', field)?.id).toBe('h1');
    expect(bedTargetArea(areas, null, tunnel)?.id).toBe('h1');
    expect(bedTargetArea(areas, null, field)?.id).toBe('g1');
    expect(bedTargetArea(areas, 'f1', field)?.id).toBe('g1');
  });

  it("starts from the owner's own beds in that Area, else the defaults", () => {
    const blocks = [
      { name: 'HT Bed 1', fieldId: 'h1', widthFt: 2.5, lengthFt: 50 },
      { name: 'HT Bed 2', fieldId: 'h1', widthFt: 50, lengthFt: 2.5 },
      { name: 'Corner', fieldId: 'g1', widthFt: 10, lengthFt: 100 }
    ];
    expect(startingBedSize(blocks, 'h1')).toEqual({
      widthFt: 2.5,
      maxLengthFt: 50,
      fromBeds: true
    });
    expect(startingBedSize([], 'g1')).toEqual({
      widthFt: DEFAULT_BED_WIDTH_FT,
      maxLengthFt: DEFAULT_MAX_BED_LENGTH_FT,
      fromBeds: false
    });
  });

  it('refuses beds that overfill the Area and says when its size is unknown', () => {
    const blocks = [{ name: 'HT Bed 1', fieldId: 'h1', widthFt: 4, lengthFt: 90 }];
    expect(areaFreeSqFt(tunnel, blocks)).toBeCloseTo(2_880 - 360);
    const many = Array.from({ length: 30 }, () => ({ widthFt: 4, lengthFt: 25 }));
    expect(bedsFit(many, tunnel, blocks).fits).toBe(false);
    expect(bedsFit(many.slice(0, 5), tunnel, blocks).fits).toBe(true);
    expect(bedsFit(many, { ...garden, acres: undefined }, []).fits).toBeNull();
  });

  it('never calls beds that fit "overfull" and never lets overfull beds through', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            widthFt: fc.integer({ min: 1, max: 10 }),
            lengthFt: fc.integer({ min: 1, max: 60 })
          }),
          { maxLength: 30 }
        ),
        fc.integer({ min: 100, max: 5_000 }),
        (beds, areaSqFt) => {
          const verdict = bedsFit(beds, { ...garden, acres: areaSqFt / SQFT }, []);
          const need = beds.reduce((s, b) => s + b.widthFt * b.lengthFt, 0);
          expect(verdict.fits).toBe(need <= areaSqFt + 1e-6);
        }
      )
    );
  });
});

describe('#707 new bed names', () => {
  const blocks = [
    ...[1, 2, 3, 4, 5, 6].map((n) => ({ name: `Bed ${n}`, fieldId: 'g1' })),
    ...[1, 2, 3].map((n) => ({ name: `HT Bed ${n}`, fieldId: 'h1' }))
  ];

  it("continues the target Area's numbering", () => {
    expect(nextBedNames(blocks, 'g1', 3)).toEqual(['Bed 7', 'Bed 8', 'Bed 9']);
  });

  it('starts at Bed 1 in an Area with no numbered beds', () => {
    const tunnelOnly = blocks.filter((b) => b.fieldId === 'h1');
    expect(nextBedNames(tunnelOnly, 'h1', 2)).toEqual(['Bed 1', 'Bed 2']);
    expect(nextBedNames(blocks, 'h1', 2)).toEqual(['Bed 7', 'Bed 8']);
  });

  it('skips names already used anywhere on the farm', () => {
    const withOther = [...blocks, { name: 'bed 8', fieldId: 'f1' }];
    expect(nextBedNames(withOther, 'g1', 3)).toEqual(['Bed 7', 'Bed 9', 'Bed 10']);
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 40 }), { maxLength: 20 }),
        fc.integer({ min: 0, max: 15 }),
        (ns, count) => {
          const existing = ns.map((n, i) => ({ name: `Bed ${n}`, fieldId: i % 2 ? 'g1' : 'f1' }));
          const names = nextBedNames(existing, 'g1', count);
          expect(names).toHaveLength(count);
          expect(new Set(names).size).toBe(count);
          const taken = new Set(existing.map((b) => b.name.toLowerCase()));
          for (const n of names) expect(taken.has(n.toLowerCase())).toBe(false);
        }
      )
    );
  });
});

describe('#708 short name lists', () => {
  const names = Array.from({ length: 29 }, (_, i) => `Bed ${i + 1}`);
  it('caps a long list', () => {
    expect(shortNameList(names)).toBe('Bed 1, Bed 2, Bed 3 and 26 more');
    expect(shortNameList(names, 'es')).toBe('Bed 1, Bed 2, Bed 3 y 26 más');
    expect(shortNameList(names.slice(0, 3))).toBe('Bed 1, Bed 2, Bed 3');
  });
});
