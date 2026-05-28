import { describe, it, expect } from 'vitest';
import { parseEnabledMethods } from './addMethods';

describe('parseEnabledMethods', () => {
  it('returns the default 5 methods when env var is absent or blank', () => {
    expect(parseEnabledMethods(undefined)).toEqual([
      'manual',
      'search',
      'barcode',
      'label',
      'photo'
    ]);
    expect(parseEnabledMethods('')).toEqual(['manual', 'search', 'barcode', 'label', 'photo']);
    expect(parseEnabledMethods('   ')).toEqual(['manual', 'search', 'barcode', 'label', 'photo']);
  });

  it('respects custom order from the env var', () => {
    expect(parseEnabledMethods('barcode,manual,label')).toEqual(['barcode', 'manual', 'label']);
  });

  it('lowercases + trims + drops unknown method names', () => {
    expect(parseEnabledMethods(' Manual , BARCODE , garbage ')).toEqual(['manual', 'barcode']);
  });

  it('dedupes repeated methods', () => {
    expect(parseEnabledMethods('manual,manual,search')).toEqual(['manual', 'search']);
  });

  it('falls back to defaults when every supplied method is unknown', () => {
    expect(parseEnabledMethods('xyz,abc')).toEqual([
      'manual',
      'search',
      'barcode',
      'label',
      'photo'
    ]);
  });

  it('accepts the photo method explicitly when restricting the set', () => {
    expect(parseEnabledMethods('manual,photo')).toEqual(['manual', 'photo']);
  });

  it('includes photo by default (Sprint 20 / Phase 26B promotion of #149)', () => {
    expect(parseEnabledMethods(undefined)).toContain('photo');
  });
});
