import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  checkAreaBlocks,
  formatFt,
  layoutSketch,
  sketchAcres,
  sketchDimsDiffer,
  storedSketchAcres,
  withSketchAcres,
  SQFT_PER_ACRE
} from './sketch';

describe('sketchAcres', () => {
  it('converts width × length in feet to acres', () => {
    expect(sketchAcres(208.71, 208.71)).toBeCloseTo(1, 3);
    expect(sketchAcres(100, 435.6)).toBe(1);
  });

  it('keeps a 4 x 8 ft bed at 32 sq ft instead of rounding it to 0.001 ac', () => {
    const acres = sketchAcres(4, 8)!;
    expect(acres * SQFT_PER_ACRE).toBeCloseTo(32, 1);
    expect(Math.round(acres * SQFT_PER_ACRE)).toBe(32);
  });

  it('reads an old 3-decimal value as the exact figure, and leaves typed acres alone', () => {
    expect(storedSketchAcres(0.001, 4, 8)! * SQFT_PER_ACRE).toBeCloseTo(32, 1);
    expect(storedSketchAcres(0.5, 4, 8)).toBe(0.5);
    expect(storedSketchAcres(0.001, null, 8)).toBe(0.001);
    expect(storedSketchAcres(null, 4, 8)).toBeNull();
  });

  it('is undefined unless both sides are positive', () => {
    expect(sketchAcres(undefined, 100)).toBeUndefined();
    expect(sketchAcres(100, null)).toBeUndefined();
    expect(sketchAcres(0, 100)).toBeUndefined();
    expect(sketchAcres(-5, 100)).toBeUndefined();
    expect(sketchAcres(Number.NaN, 100)).toBeUndefined();
  });
});

describe('withSketchAcres', () => {
  it('fills acres when both dimensions are set and acres is left out', () => {
    expect(withSketchAcres({ widthFt: 100, lengthFt: 435.6 })).toEqual({
      widthFt: 100,
      lengthFt: 435.6,
      acres: 1
    });
  });

  it('keeps explicit acres, including an explicit clear', () => {
    expect(withSketchAcres({ widthFt: 100, lengthFt: 100, acres: 3 }).acres).toBe(3);
    expect(withSketchAcres({ widthFt: 100, lengthFt: 100, acres: null }).acres).toBeNull();
  });

  it('leaves the patch alone when dimensions are missing or cleared', () => {
    const patch = { widthFt: null, lengthFt: null };
    expect(withSketchAcres(patch)).toBe(patch);
  });
});

describe('layoutSketch', () => {
  it('returns an empty layout with nothing sized', () => {
    const out = layoutSketch([{ id: 'f', name: 'Bare' }], []);
    expect(out.fields).toEqual([]);
    expect(out.unsized).toEqual(['Bare']);
  });

  it('draws a measured field at its entered size', () => {
    const out = layoutSketch([{ id: 'f', name: 'North', widthFt: 300, lengthFt: 150 }], []);
    expect(out.fields[0]).toMatchObject({ x: 0, y: 0, w: 300, h: 150, measured: true });
    expect(out.width).toBe(300);
    expect(out.height).toBe(150);
  });

  it('falls back to a square from acres', () => {
    const out = layoutSketch([{ id: 'f', name: 'Acres only', acres: 1 }], []);
    expect(out.fields[0].w).toBeCloseTo(Math.sqrt(SQFT_PER_ACRE));
    expect(out.fields[0].measured).toBe(false);
  });

  it('packs blocks inside their field and flags ones that run past the edge', () => {
    const out = layoutSketch(
      [{ id: 'f', name: 'F', widthFt: 100, lengthFt: 100 }],
      [
        { id: 'a', name: 'A', fieldId: 'f', widthFt: 40, lengthFt: 40 },
        { id: 'b', name: 'B', fieldId: 'f', widthFt: 40, lengthFt: 40 },
        { id: 'c', name: 'C', fieldId: 'f', widthFt: 100, lengthFt: 80 }
      ]
    );
    const [a, b, c] = out.fields[0].blocks;
    expect(a).toMatchObject({ x: 0, y: 0, fits: true });
    expect(b.x).toBeGreaterThan(a.x + a.w);
    expect(b.y).toBe(0);
    expect(c.y).toBeGreaterThan(a.y + a.h);
    expect(c.fits).toBe(false);
  });

  it('sizes an unmeasured field around its blocks', () => {
    const out = layoutSketch(
      [{ id: 'f', name: 'Home' }],
      [{ id: 'a', name: 'Beds', fieldId: 'f', widthFt: 30, lengthFt: 60 }]
    );
    expect(out.fields[0]).toMatchObject({ w: 30, h: 60 });
    expect(out.fields[0].blocks[0].fits).toBe(true);
    expect(out.unsized).toEqual([]);
  });

  it('names Areas with blocks past their edge (#636)', () => {
    const out = layoutSketch(
      [
        { id: 'n', name: 'North Field', widthFt: 660, lengthFt: 660 },
        { id: 'w', name: 'Wheat Field', widthFt: 660, lengthFt: 660 }
      ],
      [
        { id: 'a', name: 'North A', fieldId: 'n', widthFt: 330, lengthFt: 660 },
        { id: 'b', name: 'North A', fieldId: 'n', widthFt: 330, lengthFt: 660 },
        { id: 'c', name: 'North B', fieldId: 'n', widthFt: 330, lengthFt: 660 },
        { id: 'd', name: 'Wheat', fieldId: 'w', widthFt: 660, lengthFt: 660 }
      ]
    );
    expect(out.overflowing).toEqual(['North Field']);
  });

  it('keeps blocks past an edge and labels clear of every other Area (#636 #655)', () => {
    const dim = fc.integer({ min: 10, max: 2000 });
    const area = fc.record({
      w: dim,
      l: dim,
      blocks: fc.array(fc.tuple(dim, dim), { maxLength: 4 }),
      label: fc.integer({ min: 0, max: 3000 })
    });
    fc.assert(
      fc.property(fc.array(area, { minLength: 1, maxLength: 8 }), (areas) => {
        const fields = areas.map((a, i) => ({
          id: `f${i}`,
          name: `F${i}`,
          widthFt: a.w,
          lengthFt: a.l
        }));
        const blocks = areas.flatMap((a, i) =>
          a.blocks.map(([w, l], j) => ({
            id: `b${i}-${j}`,
            name: `B${j}`,
            fieldId: `f${i}`,
            widthFt: w,
            lengthFt: l
          }))
        );
        const labelH = 40;
        const out = layoutSketch(fields, blocks, {
          widthFt: (f) => areas[Number(f.id.slice(1))].label,
          heightFt: labelH
        });
        const extent = out.fields.map((f, i) => {
          const right = Math.max(
            f.x + f.w,
            f.x + areas[i].label,
            ...f.blocks.map((b) => b.x + b.w)
          );
          const bottom = Math.max(f.y + f.h, ...f.blocks.map((b) => b.y + b.h));
          return { x: f.x, y: f.y - labelH, r: right, b: bottom };
        });
        for (let i = 0; i < extent.length; i++) {
          const p = extent[i];
          expect(p.y).toBeGreaterThanOrEqual(-1e-6);
          expect(p.r).toBeLessThanOrEqual(out.width + 1e-6);
          expect(p.b).toBeLessThanOrEqual(out.height + 1e-6);
          for (let j = i + 1; j < extent.length; j++) {
            const q = extent[j];
            const apart = p.r <= q.x || q.r <= p.x || p.b <= q.y || q.b <= p.y;
            expect(apart).toBe(true);
          }
        }
      })
    );
  });

  it('never overlaps two fields', () => {
    const dim = fc.integer({ min: 10, max: 5000 });
    fc.assert(
      fc.property(fc.array(fc.tuple(dim, dim), { minLength: 1, maxLength: 12 }), (sizes) => {
        const out = layoutSketch(
          sizes.map(([w, l], i) => ({ id: `f${i}`, name: `F${i}`, widthFt: w, lengthFt: l })),
          []
        );
        expect(out.fields).toHaveLength(sizes.length);
        for (let i = 0; i < out.fields.length; i++) {
          const p = out.fields[i];
          expect(p.x + p.w).toBeLessThanOrEqual(out.width + 1e-6);
          expect(p.y + p.h).toBeLessThanOrEqual(out.height + 1e-6);
          for (let j = i + 1; j < out.fields.length; j++) {
            const q = out.fields[j];
            const apart =
              p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
            expect(apart).toBe(true);
          }
        }
      })
    );
  });
});

describe('formatFt', () => {
  it('prints feet by default and metres for metric users', () => {
    expect(formatFt(1234.4)).toBe('1,234 ft');
    expect(formatFt(100, { units: 'metric' })).toBe('30 m');
  });
});

describe('sketchDimsDiffer (#634)', () => {
  it('flags typed dimensions far from the drawn size', () => {
    expect(sketchDimsDiffer(926 / SQFT_PER_ACRE, 10, 16)).toBe(true);
    expect(sketchDimsDiffer(160 / SQFT_PER_ACRE, 10, 16)).toBe(false);
    expect(sketchDimsDiffer(170 / SQFT_PER_ACRE, 10, 16)).toBe(false);
    expect(sketchDimsDiffer(undefined, 10, 16)).toBe(false);
    expect(sketchDimsDiffer(1, undefined, 16)).toBe(false);
  });
});

describe('checkAreaBlocks (#636)', () => {
  it('warns when blocks add up to more than the Area and when a name repeats', () => {
    const out = checkAreaBlocks(10, [
      { name: 'North A', acres: 5 },
      { name: 'north a ', acres: 5 },
      { name: 'North B', acres: 5 }
    ]);
    expect(out.over).toEqual({ blocksAcres: 15, areaAcres: 10 });
    expect(out.duplicates).toEqual(['North A']);
  });

  it('stays quiet when blocks fit, the Area has no size, or names differ', () => {
    expect(checkAreaBlocks(10, [{ name: 'A', acres: 10 }])).toEqual({ over: null, duplicates: [] });
    expect(checkAreaBlocks(undefined, [{ name: 'A', acres: 50 }]).over).toBeNull();
    const blank = checkAreaBlocks(10, [
      { name: '', acres: 1 },
      { name: ' ', acres: 1 }
    ]);
    expect(blank.duplicates).toEqual([]);
  });
});
