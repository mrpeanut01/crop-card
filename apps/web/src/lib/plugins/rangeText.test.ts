import { describe, expect, it } from 'vitest';
import { rangeText } from './rangeText';

describe('rangeText (#237)', () => {
  it('formats a {min,max} range object instead of [object Object]', () => {
    expect(rangeText({ min: 2, max: 4 })).toBe('2–4');
    expect(rangeText({ min: 84, max: 88 })).toBe('84–88');
  });

  it('collapses an equal range to one number', () => {
    expect(rangeText({ min: 3, max: 3 })).toBe('3');
  });

  it('keeps legacy scalar values', () => {
    expect(rangeText(2)).toBe('2');
  });

  it('renders half-open ranges', () => {
    expect(rangeText({ min: 12 })).toBe('≥12');
    expect(rangeText({ max: 15 })).toBe('≤15');
  });

  it('returns undefined for unusable shapes', () => {
    for (const v of [undefined, null, 'two', [], {}, { min: 'a' }, Number.NaN]) {
      expect(rangeText(v)).toBeUndefined();
    }
  });
});
