import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  appliedAmount,
  nutrientFromStorage,
  nutrientToStorage,
  nutrientsFromAnalysis,
  rateBaseUnit
} from './applicationMath';

const UREA = { n: 46, p: 0, k: 0 };

describe('nutrient storage (#738)', () => {
  it('keeps not known apart from zero', () => {
    expect(nutrientFromStorage(nutrientToStorage(undefined))).toBeNull();
    expect(nutrientFromStorage(nutrientToStorage(null))).toBeNull();
    expect(nutrientFromStorage(nutrientToStorage(0))).toBe(0);
    expect(nutrientFromStorage(nutrientToStorage(29.9))).toBe(29.9);
  });

  it('round-trips any known amount to the hundredth', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 100_000, noNaN: true }), (v) => {
        const back = nutrientFromStorage(nutrientToStorage(v));
        expect(back).not.toBeNull();
        expect(Math.abs(back! - v)).toBeLessThanOrEqual(0.005 + 1e-9);
      })
    );
  });
});

describe('rate units (#739)', () => {
  it('reads a per-acre code and a bare stock unit the same', () => {
    expect(rateBaseUnit('lb-per-acre')).toBe('lb');
    expect(rateBaseUnit('lb')).toBe('lb');
    expect(rateBaseUnit('fl-oz-per-acre')).toBe('fl-oz');
    expect(rateBaseUnit('wheelbarrows')).toBeNull();
    expect(rateBaseUnit('ton-per-acre')).toBeNull();
  });

  it('works out what went on the block from rate x acres', () => {
    expect(appliedAmount(65, 'lb-per-acre', 15)).toEqual({ amount: 975, unit: 'lb' });
    expect(appliedAmount(18, 'gal', 2.5)).toEqual({ amount: 45, unit: 'gal' });
    expect(appliedAmount(65, 'lb-per-acre', null)).toBeNull();
    expect(appliedAmount(65, 'lb-per-acre', 0)).toBeNull();
    expect(appliedAmount(2, 'wheelbarrows', 1)).toBeNull();
    expect(appliedAmount(0, 'lb-per-acre', 1)).toBeNull();
  });
});

describe('nutrients from the analysis (#739)', () => {
  it('gives urea at 65 lb/ac about 30 lb N', () => {
    expect(nutrientsFromAnalysis(65, 'lb-per-acre', UREA)).toEqual({ n: 29.9, p: 0, k: 0 });
  });

  it('converts a weight rate to pounds first', () => {
    expect(nutrientsFromAnalysis(16, 'oz-per-acre', UREA)?.n).toBe(0.46);
  });

  it('gives nothing for a volume rate, a typed unit, no rate or no analysis', () => {
    expect(nutrientsFromAnalysis(18, 'gal-per-acre', { n: 28, p: 0, k: 0 })).toBeNull();
    expect(nutrientsFromAnalysis(2, 'wheelbarrows', UREA)).toBeNull();
    expect(nutrientsFromAnalysis(null, 'lb-per-acre', UREA)).toBeNull();
    expect(nutrientsFromAnalysis(65, 'lb-per-acre', null)).toBeNull();
  });

  it('never delivers more of a nutrient than the product weighed', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 5000, noNaN: true }),
        fc.record({
          n: fc.integer({ min: 0, max: 100 }),
          p: fc.integer({ min: 0, max: 100 }),
          k: fc.integer({ min: 0, max: 100 })
        }),
        (rate, analysis) => {
          const out = nutrientsFromAnalysis(rate, 'lb-per-acre', analysis)!;
          for (const v of [out.n, out.p, out.k]) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(rate + 0.005);
          }
        }
      )
    );
  });
});
