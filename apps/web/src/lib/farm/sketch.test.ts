import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatFt, layoutSketch, sketchAcres, withSketchAcres, SQFT_PER_ACRE } from './sketch';

describe('sketchAcres', () => {
  it('converts width × length in feet to acres', () => {
    expect(sketchAcres(208.71, 208.71)).toBeCloseTo(1, 3);
    expect(sketchAcres(100, 435.6)).toBe(1);
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
