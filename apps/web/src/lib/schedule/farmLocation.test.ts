import { describe, expect, it } from 'vitest';
import { normalizeFrost, parseLatLon } from './farmLocation';

describe('parseLatLon', () => {
  it('accepts in-range coordinates', () => {
    expect(parseLatLon('39.1', '-77.55')).toEqual({ lat: 39.1, lon: -77.55 });
    expect(parseLatLon(' -90 ', '180')).toEqual({ lat: -90, lon: 180 });
  });
  it('rejects missing, non-numeric and out-of-range values', () => {
    expect(parseLatLon('', '-77')).toBeNull();
    expect(parseLatLon('39', null)).toBeNull();
    expect(parseLatLon('abc', '-77')).toBeNull();
    expect(parseLatLon('91', '0')).toBeNull();
    expect(parseLatLon('0', '-181')).toBeNull();
    expect(parseLatLon('Infinity', '0')).toBeNull();
  });
});

describe('normalizeFrost', () => {
  it('takes MM-DD out of an ISO date', () => {
    expect(normalizeFrost('2026-04-15')).toBe('04-15');
  });
  it('keeps a valid MM-DD', () => {
    expect(normalizeFrost('10-15')).toBe('10-15');
  });
  it('returns null for blanks and garbage', () => {
    expect(normalizeFrost('')).toBeNull();
    expect(normalizeFrost(undefined)).toBeNull();
    expect(normalizeFrost('13-01')).toBeNull();
    expect(normalizeFrost('April')).toBeNull();
  });
  it('accepts M/D and pads single digits', () => {
    expect(normalizeFrost('4/5')).toBe('04-05');
    expect(normalizeFrost('4-5')).toBe('04-05');
    expect(normalizeFrost('02/29')).toBe('02-29');
  });
  it('rejects days past the end of the month', () => {
    for (const bad of ['02-30', '2/30', '02-31', '04-31', '2026-06-31', '00-10', '01-00']) {
      expect(normalizeFrost(bad)).toBeNull();
    }
  });
});
