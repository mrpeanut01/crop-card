import { describe, expect, it } from 'vitest';
import { parseFarmProfile, profileIncludesFarm, profileIncludesGarden } from './profile';

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
