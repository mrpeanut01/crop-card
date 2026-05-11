import { afterEach, describe, expect, it } from 'vitest';
import {
  computeContextVersion,
  getCachedFarmContext,
  setCachedFarmContext,
  setPrebuiltSystemPrompt,
  clearAiContextCache,
  getAiContextCacheStats
} from './aiContextCache';
import type { FarmContext } from './aiPlanning';

const baseContext = (overrides: Partial<FarmContext> = {}): FarmContext => ({
  latLon: { lat: 39.09, lon: -77.6 },
  lastFrostMs: Date.UTC(2026, 3, 15),
  firstFrostMs: Date.UTC(2026, 9, 15),
  blocks: [
    { id: 'b1', label: 'B1', eastWestIndex: 0, northSouthIndex: 0, acres: 0.5, sunExposure: 'full' }
  ],
  cropCatalog: [
    { pluginId: 'corn-bb', family: 'corn', dtmMin: 95, dtmMax: 110, shadeCasting: true, matureHeightFt: 7 }
  ],
  ...overrides
});

describe('aiContextCache', () => {
  afterEach(() => clearAiContextCache());

  it('returns cache miss for an unknown version', () => {
    const v = computeContextVersion(baseContext());
    expect(getCachedFarmContext(v)).toBeNull();
  });

  it('round-trips a stored entry', () => {
    const ctx = baseContext();
    const v = computeContextVersion(ctx);
    setCachedFarmContext(v, ctx);
    const hit = getCachedFarmContext(v);
    expect(hit).not.toBeNull();
    expect(hit?.context).toBe(ctx);
  });

  it('block ordering does not change the version hash', () => {
    const a: FarmContext = baseContext({
      blocks: [
        { id: 'b1', label: 'B1', eastWestIndex: 0, northSouthIndex: 0, acres: 1, sunExposure: 'full' },
        { id: 'b2', label: 'B2', eastWestIndex: 1, northSouthIndex: 0, acres: 2, sunExposure: 'full' }
      ]
    });
    const b: FarmContext = baseContext({
      blocks: [
        { id: 'b2', label: 'B2', eastWestIndex: 1, northSouthIndex: 0, acres: 2, sunExposure: 'full' },
        { id: 'b1', label: 'B1', eastWestIndex: 0, northSouthIndex: 0, acres: 1, sunExposure: 'full' }
      ]
    });
    expect(computeContextVersion(a)).toBe(computeContextVersion(b));
  });

  it('block mutation produces a different version hash', () => {
    const a = baseContext();
    const b = baseContext({
      blocks: [
        { id: 'b1', label: 'B1', eastWestIndex: 0, northSouthIndex: 0, acres: 0.6, sunExposure: 'full' }
      ]
    });
    expect(computeContextVersion(a)).not.toBe(computeContextVersion(b));
  });

  it('attaching a prebuilt system prompt is round-trippable', () => {
    const ctx = baseContext();
    const v = computeContextVersion(ctx);
    setCachedFarmContext(v, ctx);
    setPrebuiltSystemPrompt(v, 'PREBUILT');
    expect(getCachedFarmContext(v)?.prebuiltSystemPrompt).toBe('PREBUILT');
  });

  it('cache stats track hits/misses', () => {
    const ctx = baseContext();
    const v = computeContextVersion(ctx);
    expect(getCachedFarmContext(v)).toBeNull();
    setCachedFarmContext(v, ctx);
    expect(getCachedFarmContext(v)).not.toBeNull();
    expect(getCachedFarmContext(v)).not.toBeNull();
    const stats = getAiContextCacheStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBeGreaterThanOrEqual(1);
    expect(stats.hitRatio).toBeGreaterThan(0);
  });
});
