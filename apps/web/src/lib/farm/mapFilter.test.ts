import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_FILTER,
  isFeatureVisible,
  isFilterActive,
  isKindVisible,
  loadMapFilter,
  mapFilterKey,
  parseMapFilter,
  saveMapFilter,
  toggleFeatureKind,
  toggleKind
} from './mapFilter';

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v)
  };
}

describe('map filter', () => {
  it('defaults to everything visible on satellite with labels', () => {
    expect(parseMapFilter(undefined)).toEqual({ ...DEFAULT_MAP_FILTER, hidden: [] });
    expect(parseMapFilter('nonsense')).toEqual({ ...DEFAULT_MAP_FILTER, hidden: [] });
  });

  it('drops unknown kinds and wrong types', () => {
    expect(
      parseMapFilter({ hidden: ['garden', 'spaceport', 3], shade: 'yes', labels: false })
    ).toEqual({
      hidden: ['garden'],
      hiddenFeatures: [],
      shade: true,
      labels: false,
      satellite: true
    });
    expect(parseMapFilter({ hiddenFeatures: ['gate', 'watercourse', 'fence', null] })).toEqual({
      ...DEFAULT_MAP_FILTER,
      hidden: [],
      hiddenFeatures: ['fence', 'gate']
    });
  });

  it('keys storage per Owner and skips storage with no Owner', () => {
    expect(mapFilterKey('owner_a')).not.toBe(mapFilterKey('owner_b'));
    expect(mapFilterKey(null)).toBeNull();
    const store = memoryStore();
    saveMapFilter(null, { ...DEFAULT_MAP_FILTER, hidden: ['barn'] }, store);
    expect(store.data.size).toBe(0);
  });

  it('round-trips per Owner without leaking between farms', () => {
    const store = memoryStore();
    saveMapFilter(
      'owner_a',
      { hidden: ['barn'], hiddenFeatures: ['path'], shade: false, labels: true, satellite: false },
      store
    );
    expect(loadMapFilter('owner_a', store)).toEqual({
      hidden: ['barn'],
      hiddenFeatures: ['path'],
      shade: false,
      labels: true,
      satellite: false
    });
    expect(loadMapFilter('owner_b', store)).toEqual({ ...DEFAULT_MAP_FILTER, hidden: [] });
  });

  it('survives storage that throws or holds bad JSON', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      }
    };
    expect(loadMapFilter('owner_a', throwing)).toEqual({ ...DEFAULT_MAP_FILTER, hidden: [] });
    expect(() => saveMapFilter('owner_a', DEFAULT_MAP_FILTER, throwing)).not.toThrow();
    const bad = memoryStore();
    bad.data.set(mapFilterKey('owner_a')!, '{not json');
    expect(loadMapFilter('owner_a', bad).hidden).toEqual([]);
    expect(loadMapFilter('owner_a', null).hidden).toEqual([]);
  });

  it('toggles kinds in canonical order', () => {
    let f = toggleKind(parseMapFilter(null), 'water');
    f = toggleKind(f, 'field');
    expect(f.hidden).toEqual(['field', 'water']);
    expect(isKindVisible(f, 'water')).toBe(false);
    expect(isKindVisible(f, 'garden')).toBe(true);
    expect(isKindVisible(f, undefined)).toBe(false);
    expect(toggleKind(f, 'water').hidden).toEqual(['field']);
  });

  it('toggles line and point kinds in canonical order, apart from Areas', () => {
    let f = toggleFeatureKind(parseMapFilter(null), 'path');
    f = toggleFeatureKind(f, 'fence');
    expect(f.hiddenFeatures).toEqual(['fence', 'path']);
    expect(f.hidden).toEqual([]);
    expect(isFeatureVisible(f, 'fence')).toBe(false);
    expect(isFeatureVisible(f, 'gate')).toBe(true);
    expect(toggleFeatureKind(f, 'fence').hiddenFeatures).toEqual(['path']);
  });

  it('reports when anything is filtered', () => {
    const base = parseMapFilter(null);
    expect(isFilterActive(base)).toBe(false);
    expect(isFilterActive(toggleFeatureKind(base, 'hydrant'))).toBe(true);
    expect(isFilterActive(toggleKind(base, 'barn'))).toBe(true);
    expect(isFilterActive({ ...base, labels: false })).toBe(true);
  });
});
