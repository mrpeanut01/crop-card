import { describe, expect, it } from 'vitest';
import {
  BRIEF_STORAGE_GOALS,
  PRESERVING_METHODS,
  PRESERVING_SUITABILITY,
  goalMethod,
  isPreservingMethod
} from './preserving';
import { PRESERVED_AS_METHODS } from '$lib/db/schema';

describe('preserving enums', () => {
  it('the preserved_as column takes exactly the plant-data methods', () => {
    expect([...PRESERVED_AS_METHODS]).toEqual([...PRESERVING_METHODS]);
  });

  it('maps every brief goal to a method, pesto to freeze and canning to none', () => {
    expect(goalMethod('pesto')).toBe('freeze');
    expect(goalMethod('can-or-jelly')).toBeNull();
    for (const g of BRIEF_STORAGE_GOALS) {
      const m = goalMethod(g);
      if (g === 'can-or-jelly') continue;
      expect(m && isPreservingMethod(m)).toBe(true);
    }
    for (const m of PRESERVING_METHODS) {
      expect(goalMethod(m)).toBe(m);
    }
  });

  it('rejects anything outside the method list', () => {
    expect(isPreservingMethod('pesto')).toBe(false);
    expect(isPreservingMethod('can-or-jelly')).toBe(false);
    expect(isPreservingMethod(undefined)).toBe(false);
  });

  it('suitability is three words', () => {
    expect([...PRESERVING_SUITABILITY]).toEqual(['good', 'fair', 'poor']);
  });
});
