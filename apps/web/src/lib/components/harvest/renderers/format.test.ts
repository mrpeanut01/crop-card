import { describe, expect, it } from 'vitest';
import { fmtRange } from './format';

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
