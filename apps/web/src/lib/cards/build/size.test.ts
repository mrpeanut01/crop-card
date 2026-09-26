import { describe, expect, it } from 'vitest';
import { formatAreaAcres, formatSize } from './size';

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
