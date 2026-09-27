import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  FARM_ANIMAL_CHOICES,
  animalsLayout,
  animalsTitle,
  individualsFirst,
  parseFarmAnimals,
  showsAnimalsNav,
  showsFarmFields,
  suggestedSpecies
} from './profile';
import { FARM_PROFILES } from '$lib/onboarding/profile';

describe('parseFarmAnimals', () => {
  it('reads one value, a comma list or a JSON array, in canonical order', () => {
    expect(parseFarmAnimals('pets')).toEqual(['pets']);
    expect(parseFarmAnimals('chickens,pets')).toEqual(['pets', 'chickens']);
    expect(parseFarmAnimals('["animals","pets"]')).toEqual(['animals', 'pets']);
    expect(parseFarmAnimals(['pets', 'animals', 'pets'])).toEqual(['animals', 'pets']);
  });

  it('drops anything unknown and never throws', () => {
    expect(parseFarmAnimals(undefined)).toEqual([]);
    expect(parseFarmAnimals('')).toEqual([]);
    expect(parseFarmAnimals('[not json')).toEqual([]);
    expect(parseFarmAnimals('{"a":1}')).toEqual([]);
    expect(parseFarmAnimals('livestock')).toEqual([]);
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        const out = parseFarmAnimals(raw);
        expect(out.every((c) => (FARM_ANIMAL_CHOICES as readonly string[]).includes(c))).toBe(true);
      })
    );
  });
});

describe('animalsLayout', () => {
  it('uses the pets layout for a garden household whatever it keeps', () => {
    expect(animalsLayout('garden', [])).toBe('pets');
    expect(animalsLayout('garden', ['chickens'])).toBe('pets');
  });

  it('uses the pets layout when the answer is pets and not farm animals', () => {
    expect(animalsLayout('farm', ['pets'])).toBe('pets');
    expect(animalsLayout('mixed', ['pets', 'chickens'])).toBe('pets');
    expect(animalsLayout('farm', ['animals', 'pets'])).toBe('farm');
  });

  it('defaults to the farm layout, including farms that predate the profile', () => {
    expect(animalsLayout(null, [])).toBe('farm');
    expect(animalsLayout('farm', ['chickens'])).toBe('farm');
  });

  it('only ever yields one of the two layouts', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(null, ...FARM_PROFILES),
        fc.subarray([...FARM_ANIMAL_CHOICES]),
        (profile, choices) => {
          const layout = animalsLayout(profile, choices);
          expect(['farm', 'pets']).toContain(layout);
          if (choices.includes('animals') && profile !== 'garden') expect(layout).toBe('farm');
        }
      )
    );
  });
});

describe('layout rules', () => {
  it('names the section by layout and never says livestock', () => {
    expect(animalsTitle('pets')).toBe('Pets & animals');
    expect(animalsTitle('farm')).toBe('Animals');
    expect(animalsTitle('pets').toLowerCase()).not.toContain('livestock');
  });

  it('hides farm fields in the pets layout and on pets anywhere', () => {
    expect(showsFarmFields('farm', 'production')).toBe(true);
    expect(showsFarmFields('farm', 'pet')).toBe(false);
    expect(showsFarmFields('pets', 'production')).toBe(false);
    expect(individualsFirst('pets')).toBe(true);
    expect(individualsFirst('farm')).toBe(false);
  });

  it('shows the nav entry once the owner said so or animals exist', () => {
    expect(showsAnimalsNav([], false)).toBe(false);
    expect(showsAnimalsNav([], true)).toBe(true);
    expect(showsAnimalsNav(['pets'], false)).toBe(true);
  });

  it('suggests chickens only for a chickens answer', () => {
    expect(suggestedSpecies(['chickens'])).toBe('chicken');
    expect(suggestedSpecies(['pets', 'chickens'])).toBeNull();
    expect(suggestedSpecies([])).toBeNull();
  });
});
