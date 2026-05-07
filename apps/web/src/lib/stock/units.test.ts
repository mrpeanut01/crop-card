import { describe, expect, it } from 'vitest';
import { convert, fromHundredths, toHundredths, toStorage } from './units';

describe('convert', () => {
  it('converts within liquid units', () => {
    expect(convert(1, 'gal', 'fl-oz')).toBe(128);
    expect(convert(1, 'qt', 'pt')).toBe(2);
    expect(convert(8, 'fl-oz', 'pt')).toBe(0.5);
  });

  it('converts within solid units', () => {
    expect(convert(1, 'lb', 'oz')).toBeCloseTo(16, 2);
    expect(convert(1, 'kg', 'g')).toBe(1000);
    expect(convert(1, 'lb', 'kg')).toBeCloseTo(0.453592, 4);
  });

  it('returns null for incompatible units', () => {
    expect(convert(1, 'gal', 'lb')).toBeNull();
    expect(convert(1, 'fl-oz', 'count')).toBeNull();
    expect(convert(1, 'count', 'lb')).toBeNull();
  });

  it('identity for same unit', () => {
    expect(convert(42, 'count', 'count')).toBe(42);
    expect(convert(3.5, 'pt', 'pt')).toBe(3.5);
  });
});

describe('hundredths round-trip', () => {
  it('preserves 2 decimal places', () => {
    expect(fromHundredths(toHundredths(1.5))).toBe(1.5);
    expect(fromHundredths(toHundredths(0.33))).toBe(0.33);
  });
});

describe('toStorage', () => {
  it('converts + scales to default-unit hundredths', () => {
    // 1 pt of a fl-oz-tracked SKU = 1600 hundredths-of-fl-oz
    expect(toStorage(1, 'pt', 'fl-oz')).toBe(1600);
    // 0.5 qt of a fl-oz-tracked SKU = 1600 hundredths
    expect(toStorage(0.5, 'qt', 'fl-oz')).toBe(1600);
  });

  it('returns null when conversion is impossible', () => {
    expect(toStorage(1, 'lb', 'gal')).toBeNull();
  });
});
