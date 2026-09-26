import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CROP_AREA_KINDS, validateAreaDetails } from '$lib/farm/areaKinds';
import { AREA_NAME_PLACEHOLDER } from '$lib/farm/kindStyle';
import {
  GROWING_CHOICES,
  GROWING_OPTIONS,
  LEGACY_STEP_IDS,
  parseGrowingChoices,
  profileForChoices,
  routeOnboarding,
  starterAreasFor
} from './steps';

describe('growing choices', () => {
  it('parses known choices in canonical order without duplicates', () => {
    expect(parseGrowingChoices(['hay', 'garden', 'hay', 'nope', 3])).toEqual(['garden', 'hay']);
    expect(parseGrowingChoices([])).toEqual([]);
  });

  it('maps choices to a profile', () => {
    expect(profileForChoices([])).toBeNull();
    expect(profileForChoices(['garden'])).toBe('garden');
    expect(profileForChoices(['greenhouse'])).toBe('garden');
    expect(profileForChoices(['garden', 'greenhouse'])).toBe('garden');
    expect(profileForChoices(['fields'])).toBe('farm');
    expect(profileForChoices(['hay'])).toBe('farm');
    expect(profileForChoices(['fields', 'greenhouse'])).toBe('mixed');
    expect(profileForChoices(['garden', 'hay'])).toBe('mixed');
  });

  it('creates one starter Area per choice with the right kind', () => {
    expect(starterAreasFor(['garden', 'fields', 'hay', 'greenhouse'])).toEqual([
      { name: 'Kitchen Garden', kind: 'garden' },
      { name: 'Home Field', kind: 'field' },
      { name: 'Hayfield', kind: 'pasture', details: { use: 'hay' } },
      { name: 'High Tunnel', kind: 'greenhouse', details: { structure: 'high-tunnel' } }
    ]);
    expect(starterAreasFor([])).toEqual([]);
  });

  it('starter Areas use the same crop-area kinds and names as the setup sheets and map', () => {
    for (const o of GROWING_OPTIONS) {
      expect(CROP_AREA_KINDS).toContain(o.starter.kind);
      expect(AREA_NAME_PLACEHOLDER[o.starter.kind]).toBe(`e.g. ${o.starter.name}`);
    }
  });

  it('starter details validate against their kind', () => {
    for (const o of GROWING_OPTIONS) {
      expect(validateAreaDetails(o.starter.kind, o.starter.details ?? null).ok).toBe(true);
    }
  });

  it('every subset gives one starter per choice and a profile only when non-empty', () => {
    fc.assert(
      fc.property(fc.subarray([...GROWING_CHOICES]), (choices) => {
        expect(starterAreasFor(choices)).toHaveLength(choices.length);
        expect(profileForChoices(choices) === null).toBe(choices.length === 0);
      })
    );
  });
});

describe('routeOnboarding', () => {
  it('shows screen 1 until the farm exists, whatever the query', () => {
    for (const step of [null, 'fields', 'growing']) {
      expect(routeOnboarding({ hasFarm: false, isOwner: false, status: null, step })).toEqual({
        kind: 'screen',
        screen: 'farm'
      });
    }
  });

  it('keeps an owner with screen 2 unanswered on screen 2', () => {
    expect(
      routeOnboarding({ hasFarm: true, isOwner: true, status: 'in-progress', step: null })
    ).toEqual({ kind: 'screen', screen: 'growing' });
  });

  it('308-redirects every legacy step to /today once a farm exists', () => {
    for (const step of LEGACY_STEP_IDS) {
      for (const status of [null, 'later', 'complete', 'in-progress']) {
        expect(routeOnboarding({ hasFarm: true, isOwner: true, status, step })).toEqual({
          kind: 'redirect',
          status: 308,
          location: '/today'
        });
      }
    }
  });

  it('sends finished owners and helpers to /today', () => {
    for (const status of [null, 'later', 'complete']) {
      expect(routeOnboarding({ hasFarm: true, isOwner: true, status, step: null })).toMatchObject({
        kind: 'redirect',
        status: 303
      });
    }
    expect(
      routeOnboarding({ hasFarm: true, isOwner: false, status: 'in-progress', step: null })
    ).toMatchObject({ kind: 'redirect', location: '/today' });
  });
});
