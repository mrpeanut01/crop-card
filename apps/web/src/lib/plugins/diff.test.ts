import { describe, expect, it } from 'vitest';
import { diffPlugins, isEmptyDiff } from './diff';

describe('diffPlugins', () => {
  it('returns an empty diff for byte-identical payloads', () => {
    const a = { pluginId: 'x', type: 'crop', version: '1.0.0', cropFamily: 'corn' };
    const b = { pluginId: 'x', type: 'crop', version: '1.0.0', cropFamily: 'corn' };
    expect(isEmptyDiff(diffPlugins(a, b))).toBe(true);
  });

  it('reports added top-level keys', () => {
    const a = { pluginId: 'x' };
    const b = { pluginId: 'x', displayName: 'X' };
    expect(diffPlugins(a, b)).toEqual({
      addedKeys: ['displayName'],
      removedKeys: [],
      changedKeys: []
    });
  });

  it('reports removed top-level keys', () => {
    const a = { pluginId: 'x', notes: 'hi' };
    const b = { pluginId: 'x' };
    expect(diffPlugins(a, b)).toEqual({
      addedKeys: [],
      removedKeys: ['notes'],
      changedKeys: []
    });
  });

  it('reports changed scalar values', () => {
    const a = { ratePerAcre: { amount: 1, unit: 'oz' } };
    const b = { ratePerAcre: { amount: 2, unit: 'oz' } };
    expect(diffPlugins(a, b)).toEqual({
      addedKeys: [],
      removedKeys: [],
      changedKeys: ['ratePerAcre.amount']
    });
  });

  it('recurses into nested objects with dotted paths', () => {
    const a = { agronomy: { rotationLookback: 2, emergenceWindow: 14 } };
    const b = { agronomy: { rotationLookback: 3, emergenceWindow: 14, density: 35000 } };
    expect(diffPlugins(a, b)).toEqual({
      addedKeys: ['agronomy.density'],
      removedKeys: [],
      changedKeys: ['agronomy.rotationLookback']
    });
  });

  it('treats arrays as opaque values (whole-array changed-or-not)', () => {
    const a = { tags: ['a', 'b'] };
    const b = { tags: ['a', 'b', 'c'] };
    expect(diffPlugins(a, b)).toEqual({
      addedKeys: [],
      removedKeys: [],
      changedKeys: ['tags']
    });
  });

  it('does not see equal arrays as changed even if reference differs', () => {
    const a = { tags: ['a', 'b'] };
    const b = { tags: ['a', 'b'] };
    expect(isEmptyDiff(diffPlugins(a, b))).toBe(true);
  });

  it('falls back to empty objects on non-object inputs', () => {
    expect(diffPlugins(null, { pluginId: 'x' })).toEqual({
      addedKeys: ['pluginId'],
      removedKeys: [],
      changedKeys: []
    });
    expect(diffPlugins({ pluginId: 'x' }, null)).toEqual({
      addedKeys: [],
      removedKeys: ['pluginId'],
      changedKeys: []
    });
  });

  it('sorts each key list', () => {
    const a = { z: 1, a: 1 };
    const b = { z: 2, a: 2, m: 1 };
    const d = diffPlugins(a, b);
    expect(d.changedKeys).toEqual(['a', 'z']);
    expect(d.addedKeys).toEqual(['m']);
  });
});
