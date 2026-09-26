import { describe, expect, it } from 'vitest';
import { fmtQtyRange, fmtRange, usText } from './format';

describe('fmtRange (#274)', () => {
  it('renders a singular value when min equals max', () => {
    expect(fmtRange({ min: 28, max: 28 })).toBe('28');
  });
  it('renders min–max when they differ', () => {
    expect(fmtRange({ min: 28, max: 35 })).toBe('28–35');
  });
  it('appends the unit when supplied', () => {
    expect(fmtRange({ min: 28, max: 35 }, 'd')).toBe('28–35 d');
    expect(fmtRange({ min: 4, max: 4 }, 'd')).toBe('4 d');
  });
  it('returns an em-dash when the range is undefined', () => {
    expect(fmtRange(undefined)).toBe('—');
  });
});

describe('fmtQtyRange', () => {
  it('renders US by default', () => {
    expect(fmtQtyRange(80, 85, 'temperature')).toBe('80–85°F');
    expect(fmtQtyRange(1, 2, 'length')).toBe('1–2 in');
  });
  it('converts for metric users', () => {
    expect(fmtQtyRange(80, 85, 'temperature', { units: 'metric' })).toBe('27–29°C');
    expect(fmtQtyRange(1, 2, 'length', { units: 'metric' })).toBe('2.5–5.1 cm');
  });
  it('collapses equal bounds', () => {
    expect(fmtQtyRange(50, 50, 'temperature', { units: 'metric' })).toBe('10°C');
  });
});

describe('usText', () => {
  it('keeps two decimals of the US value', () => {
    expect(usText(22.046226)).toBe('22.05');
    expect(usText(12)).toBe('12');
  });
  it('returns empty for missing values', () => {
    expect(usText(null)).toBe('');
    expect(usText(Number.NaN)).toBe('');
  });
});
