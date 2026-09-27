import { describe, expect, it } from 'vitest';
import {
  parseFarmAnimals,
  parseFarmProfile,
  profileIncludesFarm,
  profileIncludesGarden,
  usesPetsLayout
} from './profile';

describe('farm profile', () => {
  it('parses only known profiles', () => {
    expect(parseFarmProfile('garden')).toBe('garden');
    expect(parseFarmProfile('mixed')).toBe('mixed');
    expect(parseFarmProfile('Garden')).toBeNull();
    expect(parseFarmProfile(undefined)).toBeNull();
  });

  it('treats a farm with no profile as a farm', () => {
    expect(profileIncludesGarden(null)).toBe(false);
    expect(profileIncludesFarm(null)).toBe(true);
  });

  it('includes garden and farm per profile', () => {
    expect([profileIncludesGarden('garden'), profileIncludesFarm('garden')]).toEqual([true, false]);
    expect([profileIncludesGarden('farm'), profileIncludesFarm('farm')]).toEqual([false, true]);
    expect([profileIncludesGarden('mixed'), profileIncludesFarm('mixed')]).toEqual([true, true]);
  });
});

describe('farm animals answer', () => {
  it('parses only known answers', () => {
    expect(parseFarmAnimals('pets')).toEqual(['pets']);
    expect(parseFarmAnimals('chickens,animals')).toEqual(['animals', 'chickens']);
    expect(parseFarmAnimals('Pets')).toEqual([]);
    expect(parseFarmAnimals(null)).toEqual([]);
  });

  it('uses the pets layout for a pets answer or a garden household', () => {
    expect(usesPetsLayout('farm', ['pets'])).toBe(true);
    expect(usesPetsLayout('farm', ['pets', 'chickens'])).toBe(true);
    expect(usesPetsLayout('garden', ['chickens'])).toBe(true);
    expect(usesPetsLayout('garden', [])).toBe(true);
    expect(usesPetsLayout('farm', ['animals', 'pets'])).toBe(false);
    expect(usesPetsLayout('mixed', ['chickens'])).toBe(false);
    expect(usesPetsLayout(null, [])).toBe(false);
  });
});
