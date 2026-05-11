import { afterEach, describe, expect, it } from 'vitest';
import {
  getDerivedSignal,
  setDerivedSignal,
  getOrComputeDerivedSignal,
  clearDerivedSignals,
  getDerivedSignalStats
} from './aiDerivedSignals';

describe('aiDerivedSignals', () => {
  afterEach(() => clearDerivedSignals());

  it('returns null on miss', () => {
    expect(getDerivedSignal('v1', 'density-per-draft')).toBeNull();
  });

  it('round-trips a stored signal', () => {
    setDerivedSignal('v1', 'density-per-draft', { foo: 1 });
    expect(getDerivedSignal('v1', 'density-per-draft')).toEqual({ foo: 1 });
  });

  it('different versions are isolated', () => {
    setDerivedSignal('v1', 'density-per-draft', 'A');
    setDerivedSignal('v2', 'density-per-draft', 'B');
    expect(getDerivedSignal<string>('v1', 'density-per-draft')).toBe('A');
    expect(getDerivedSignal<string>('v2', 'density-per-draft')).toBe('B');
  });

  it('subKey isolates entries within the same version + kind', () => {
    setDerivedSignal('v1', 'candidacy-matrix', 'first', 'planA');
    setDerivedSignal('v1', 'candidacy-matrix', 'second', 'planB');
    expect(getDerivedSignal<string>('v1', 'candidacy-matrix', 'planA')).toBe('first');
    expect(getDerivedSignal<string>('v1', 'candidacy-matrix', 'planB')).toBe('second');
  });

  it('getOrCompute caches the compute result on miss', async () => {
    let computeCount = 0;
    const compute = () => {
      computeCount++;
      return { computed: 42 };
    };
    const a = await getOrComputeDerivedSignal('v1', 'viable-windows', compute);
    const b = await getOrComputeDerivedSignal('v1', 'viable-windows', compute);
    expect(a).toEqual({ computed: 42 });
    expect(b).toEqual({ computed: 42 });
    expect(computeCount).toBe(1);
  });

  it('stats track hits, misses, and per-kind counts', async () => {
    setDerivedSignal('v1', 'rotation-history', { yr: 2026 });
    getDerivedSignal('v1', 'rotation-history');
    getDerivedSignal('v1', 'density-per-draft');
    const stats = getDerivedSignalStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.byKind['rotation-history']).toBe(1);
  });
});
