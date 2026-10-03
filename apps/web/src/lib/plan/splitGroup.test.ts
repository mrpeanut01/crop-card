import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  SPLIT_GROUP_ID_PATTERN,
  apportionLotQuantity,
  mintSplitGroupId,
  splitGroupBlocks,
  splitGroupIds,
  splitLots,
  splitNoun
} from './splitGroup';

describe('splitLots', () => {
  it('counts distinct blocks and leaves out lots on one block', () => {
    const m = splitLots([
      { stockItemId: 'a', blockId: 'b1' },
      { stockItemId: 'a', blockId: 'b2' },
      { stockItemId: 'a', blockId: 'b2' },
      { stockItemId: 'c', blockId: 'b1' },
      { stockItemId: 'c', blockId: 'b1' }
    ]);
    expect([...m]).toEqual([['a', 2]]);
  });
});

describe('apportionLotQuantity (R-18)', () => {
  it('splits whole seeds by largest remainder', () => {
    const m = apportionLotQuantity(100, 'seeds', [
      { key: 'x', plants: 1 },
      { key: 'y', plants: 1 },
      { key: 'z', plants: 1 }
    ]);
    expect([...m.values()].reduce((s, v) => s + v, 0)).toBe(100);
    expect([...m.values()].sort()).toEqual([33, 33, 34]);
  });

  it('gives the rounding rest to the largest remainder for weights', () => {
    const m = apportionLotQuantity(1, 'oz', [
      { key: 'x', plants: 1 },
      { key: 'y', plants: 1 },
      { key: 'z', plants: 1 }
    ]);
    expect(m.get('x')).toBe(0.334);
    expect(m.get('y')).toBe(0.333);
    expect(m.get('z')).toBe(0.333);
  });

  it('never gives a row a negative amount for a tiny weight split over many rows', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ key: `r${i}`, plants: 10 }));
    const m = apportionLotQuantity(0.012, 'oz', rows);
    const values = [...m.values()];
    expect(values.every((v) => v >= 0)).toBe(true);
    expect(Math.round(values.reduce((s, v) => s + v, 0) * 1000)).toBe(12);
  });

  it('keeps every row at zero or more and adds up to the lot (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 50, noNaN: true }),
        fc.constantFrom('oz', 'lb', 'g', 'seeds'),
        fc.array(fc.integer({ min: 0, max: 500 }), { minLength: 1, maxLength: 20 }),
        (qty, unit, plants) => {
          const rows = plants.map((p, i) => ({ key: `r${i}`, plants: p }));
          const m = apportionLotQuantity(qty, unit, rows);
          const values = [...m.values()];
          expect(values.every((v) => v >= 0)).toBe(true);
          const scale = unit === 'seeds' ? 1 : 1000;
          expect(Math.round(values.reduce((s, v) => s + v, 0) * scale)).toBe(
            Math.round(qty * scale)
          );
        }
      )
    );
  });

  it('splits evenly when every row has zero plants', () => {
    const m = apportionLotQuantity(4, 'count', [
      { key: 'x', plants: 0 },
      { key: 'y', plants: 0 }
    ]);
    expect([...m.values()]).toEqual([2, 2]);
  });

  it('always adds up to the selected quantity (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.constantFrom('seeds', 'count', 'packets'),
        fc.array(fc.integer({ min: 0, max: 5000 }), { minLength: 1, maxLength: 12 }),
        (qty, unit, plants) => {
          const rows = plants.map((p, i) => ({ key: `r${i}`, plants: p }));
          const m = apportionLotQuantity(qty, unit, rows);
          const values = [...m.values()];
          expect(values.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
          expect(values.reduce((s, v) => s + v, 0)).toBe(qty);
        }
      )
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }).map((n) => n / 1000),
        fc.constantFrom('oz', 'lb', 'g'),
        fc.array(fc.integer({ min: 0, max: 5000 }), { minLength: 1, maxLength: 12 }),
        (qty, unit, plants) => {
          const rows = plants.map((p, i) => ({ key: `r${i}`, plants: p }));
          const values = [...apportionLotQuantity(qty, unit, rows).values()];
          const sum = Math.round(values.reduce((s, v) => s + v, 0) * 1000) / 1000;
          expect(sum).toBe(qty);
          for (const v of values) expect(Math.round(v * 1000) / 1000).toBe(v);
        }
      )
    );
  });
});

describe('group ids (R-12)', () => {
  it('mints one id per split lot and none for a lot on one block', () => {
    let n = 0;
    const ids = splitGroupIds(
      [
        { stockItemId: 'a', blockId: 'b1' },
        { stockItemId: 'a', blockId: 'b2' },
        { stockItemId: 'a', blockId: 'b1' },
        { stockItemId: 'c', blockId: 'b1' }
      ],
      () => `sg_test-${++n}-abcdefgh`
    );
    expect([...ids]).toEqual([['a', 'sg_test-1-abcdefgh']]);
  });

  it('mints ids the plantings endpoint accepts', () => {
    for (let i = 0; i < 20; i++) expect(mintSplitGroupId()).toMatch(SPLIT_GROUP_ID_PATTERN);
    expect('sg_short').not.toMatch(SPLIT_GROUP_ID_PATTERN);
    expect('sg_has space here').not.toMatch(SPLIT_GROUP_ID_PATTERN);
  });
});

describe('splitGroupBlocks (R-22)', () => {
  const blocks = [
    {
      id: 'b1',
      name: 'Bed 1',
      fieldId: 'g',
      plantings: [{ splitGroupId: 'sg_1', status: 'planned' }]
    },
    {
      id: 'b2',
      name: 'Bed 2',
      fieldId: 'g',
      plantings: [
        { splitGroupId: 'sg_1', status: 'active' },
        { splitGroupId: 'sg_1', status: 'planned' }
      ]
    },
    { id: 'b3', name: 'Bed 3', plantings: [{ splitGroupId: 'sg_1', status: 'archived' }] },
    { id: 'b4', name: 'Bed 4', plantings: [{ splitGroupId: 'sg_2', status: 'failed' }] },
    { id: 'b5', name: 'Bed 5', plantings: [{ splitGroupId: 'sg_2', status: 'active' }] }
  ];

  it('counts distinct blocks with a live part and drops groups under 2', () => {
    const m = splitGroupBlocks(blocks);
    expect([...m.keys()]).toEqual(['sg_1']);
    expect(m.get('sg_1')!.map((b) => b.blockId)).toEqual(['b1', 'b2']);
  });
});

describe('splitNoun (R-20)', () => {
  it('says beds only when every block is a bed', () => {
    expect(splitNoun(['a', 'b'], ['a', 'b', 'c'])).toBe('beds');
    expect(splitNoun(['a', 'x'], new Set(['a']))).toBe('blocks');
    expect(splitNoun([], ['a'])).toBe('blocks');
  });
});
