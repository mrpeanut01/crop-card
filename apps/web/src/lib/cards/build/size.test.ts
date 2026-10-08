import { describe, expect, it } from 'vitest';
import { formatAreaAcres, formatFeet, formatSize } from './size';
import { formatFt } from '$lib/farm/sketch';

const us = { units: 'us' as const };

describe('formatAreaAcres', () => {
  it('shows a garden in square feet, not 0 ac', () => {
    expect(formatAreaAcres(600 / 43_560, us)).toBe('600 sq ft');
    expect(formatAreaAcres(0.2, us)).toBe('8,712 sq ft');
    expect(formatAreaAcres(600 / 43_560, { units: 'metric' })).toBe('56 m²');
  });

  it('keeps acres for bigger areas', () => {
    expect(formatAreaAcres(2.5, us)).toMatch(/ac/);
  });

  it('sizes a typed small acreage in square feet too', () => {
    expect(formatSize({ acres: 0.05, widthFt: null, lengthFt: null }, us)).toBe('2,178 sq ft');
  });
});

describe('size units follow the viewer language (#621)', () => {
  const es = { units: 'us' as const, locale: 'es' };
  it('writes Spanish unit words with a Spanish locale', () => {
    expect(formatAreaAcres(2400 / 43_560, es)).toBe('2,400 pies²');
    expect(formatAreaAcres(2.75, es)).toBe('2.75 acres');
    expect(formatSize({ acres: null, widthFt: 40, lengthFt: 60 }, es)).toBe('40×60 pies');
    expect(formatFeet(12, es)).toBe('12 pies');
    expect(formatFt(40, es)).toBe('40 pies');
  });

  it('stays byte-identical English without a locale or in English', () => {
    for (const p of [us, { units: 'us' as const, locale: 'en' }]) {
      expect(formatAreaAcres(2400 / 43_560, p)).toBe('2,400 sq ft');
      expect(formatAreaAcres(2.75, p)).toBe('2.75 ac');
      expect(formatSize({ acres: null, widthFt: 40, lengthFt: 60 }, p)).toBe('40×60 ft');
      expect(formatFeet(12, p)).toBe('12 ft');
      expect(formatFt(40, p)).toBe('40 ft');
    }
  });

  it('leaves metric units alone', () => {
    const m = { units: 'metric' as const, locale: 'es' };
    expect(formatAreaAcres(2.75, m)).toBe('1.11 ha');
    expect(formatSize({ acres: null, widthFt: 40, lengthFt: 60 }, m)).toBe('12.2×18.3 m');
  });
});
