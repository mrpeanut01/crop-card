import { describe, expect, it } from 'vitest';
import { allowsPartialSession } from '../../src/hooks.server';

describe('routes a signed-in user without a farm can reach', () => {
  it('lets onboarding call the address geocoder before a farm exists', () => {
    expect(allowsPartialSession('/api/geocode', false)).toBe(true);
    expect(allowsPartialSession('/onboarding', false)).toBe(true);
  });

  it('keeps tenant-scoped routes behind a completed session', () => {
    for (const p of [
      '/api/fields',
      '/api/blocks',
      '/api/geocode/extra',
      '/today',
      '/admin/owners'
    ]) {
      expect(allowsPartialSession(p, false)).toBe(false);
    }
    expect(allowsPartialSession('/admin/owners', true)).toBe(true);
  });
});
