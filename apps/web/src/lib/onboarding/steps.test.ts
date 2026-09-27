import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CROP_AREA_KINDS, isCropBearing, validateAreaDetails } from '$lib/farm/areaKinds';
import { isHousingAreaKind } from '$lib/animals/model';
import { AREA_NAME_PLACEHOLDER } from '$lib/farm/kindStyle';
import {
  ANIMAL_CHOICES,
  ANIMAL_OPTIONS,
  farmAnimalsFor,
  parseAnimalChoices,
  profileForAnswers,
  starterAreasForAnswers,
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

describe('animal tiles', () => {
  it('parses known animal choices in canonical order without duplicates', () => {
    expect(parseAnimalChoices(['chickens', 'pets', 'chickens', 'cows', null])).toEqual([
      'pets',
      'chickens'
    ]);
    expect(parseAnimalChoices([])).toEqual([]);
  });

  it('lets an animals-only answer through, with the household reading for pets and hens', () => {
    expect(profileForAnswers([], ['animals'])).toBe('farm');
    expect(profileForAnswers([], ['pets'])).toBe('garden');
    expect(profileForAnswers([], ['chickens'])).toBe('garden');
    expect(profileForAnswers([], ['pets', 'chickens'])).toBe('garden');
    expect(profileForAnswers([], ['animals', 'pets'])).toBe('farm');
    expect(profileForAnswers([], [])).toBeNull();
  });

  it('keeps the growing answer, and adds the farm side for Animals', () => {
    expect(profileForAnswers(['garden'], ['pets', 'chickens'])).toBe('garden');
    expect(profileForAnswers(['garden'], ['animals'])).toBe('mixed');
    expect(profileForAnswers(['fields'], ['pets'])).toBe('farm');
    expect(profileForAnswers(['fields'], ['animals'])).toBe('farm');
    expect(profileForAnswers(['garden', 'hay'], ['chickens'])).toBe('mixed');
  });

  it('stores every picked tile as the farm_animals answer', () => {
    expect(farmAnimalsFor([])).toBeNull();
    expect(farmAnimalsFor(['pets'])).toEqual(['pets']);
    expect(farmAnimalsFor(['chickens', 'pets'])).toEqual(['pets', 'chickens']);
    expect(farmAnimalsFor(['animals', 'pets', 'chickens'])).toEqual([
      'animals',
      'pets',
      'chickens'
    ]);
  });

  it('seeds a Barn for animals, a Coop for chickens and nothing for pets', () => {
    expect(starterAreasForAnswers([], ['pets'])).toEqual([]);
    expect(starterAreasForAnswers(['garden'], ['animals', 'pets', 'chickens'])).toEqual([
      { name: 'Kitchen Garden', kind: 'garden' },
      { name: 'Barn', kind: 'barn' },
      { name: 'Chicken Coop', kind: 'coop_pen' }
    ]);
  });

  it('animal starters can house animals, are not crop ground and validate', () => {
    for (const o of ANIMAL_OPTIONS) {
      if (!o.starter) continue;
      expect(isHousingAreaKind(o.starter.kind)).toBe(true);
      expect(isCropBearing(o.starter.kind)).toBe(false);
      expect(validateAreaDetails(o.starter.kind, o.starter.details ?? null).ok).toBe(true);
    }
  });

  it('copy never says livestock and uses no long dashes', () => {
    for (const o of ANIMAL_OPTIONS) {
      expect(`${o.title} ${o.blurb}`).not.toMatch(/livestock|[\u2013\u2014]/i);
    }
  });

  it('any mix of tiles gives a profile exactly when something was picked', () => {
    fc.assert(
      fc.property(
        fc.subarray([...GROWING_CHOICES]),
        fc.subarray([...ANIMAL_CHOICES]),
        (growing, animals) => {
          const profile = profileForAnswers(growing, animals);
          expect(profile === null).toBe(growing.length === 0 && animals.length === 0);
          if (growing.length > 0 && animals.length === 0) {
            expect(profile).toBe(profileForChoices(growing));
          }
          if (animals.includes('animals')) expect(profile).not.toBe('garden');
          expect(farmAnimalsFor(animals) === null).toBe(animals.length === 0);
        }
      )
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
