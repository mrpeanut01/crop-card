import { describe, expect, it } from 'vitest';
import {
  KEEP_IN_ONE_BED_MAX,
  normalizeKeepInOneBed,
  parseKeepInOneBed,
  withKeepInOneBed
} from './keepInOneBed';

describe('keep in one bed setting (R-15)', () => {
  it('parses the stored list and drops anything malformed', () => {
    expect(parseKeepInOneBed(undefined)).toEqual([]);
    expect(parseKeepInOneBed('not json')).toEqual([]);
    expect(parseKeepInOneBed('{"a":1}')).toEqual([]);
    expect(parseKeepInOneBed('["b","a",3,"a",""]')).toEqual(['a', 'b']);
  });

  it('keeps the list sorted, unique and capped', () => {
    const many = Array.from({ length: 600 }, (_, i) => `c${String(i).padStart(4, '0')}`);
    expect(normalizeKeepInOneBed(many)).toHaveLength(KEEP_IN_ONE_BED_MAX);
    expect(withKeepInOneBed(['b'], 'a', true)).toEqual(['a', 'b']);
    expect(withKeepInOneBed(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(withKeepInOneBed(['a'], 'a', true)).toEqual(['a']);
  });
});
