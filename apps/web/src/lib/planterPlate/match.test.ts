/**
 * Engine tests for the planter-plate matcher (Phase 1 of the restructure).
 * These tests run against the canonical Lincoln Ag catalog and do not
 * require a database — the matcher is pure.
 */

import { describe, expect, it } from 'vitest';
import { getPlatesCatalog } from './catalog';
import {
  CLASS_DEFAULT_DIMS_MM,
  cellCountRecommendation,
  inferSeedTypeFromName,
  isLowConfidence,
  matchPlates,
  mmToInternal
} from './match';

const catalog = getPlatesCatalog();

describe('matchPlates', () => {
  it('exact-dim corn match surfaces the right plate at Δ=0', () => {
    // B13-16 lives at 38-15-20 sixty-fourths.
    const res = matchPlates(catalog, {
      seedType: 'Corn',
      series: 'B',
      shape: 'Flat',
      cells: 16,
      dimensions: { L: 38, D: 15, T: 20 },
      toleranceInternal: 0
    });
    expect(res[0]?.plateNumber).toBe('B13-16');
    expect(res[0]?.delta).toBe(0);
  });

  it('tolerance budget widens to admit near matches', () => {
    // Without tolerance, only exact 38-15-20 matches.
    const exact = matchPlates(catalog, {
      seedType: 'Corn',
      series: 'B',
      cells: 16,
      shape: 'Flat',
      dimensions: { L: 38, D: 15, T: 20 },
      toleranceInternal: 0
    });
    expect(exact.length).toBeGreaterThanOrEqual(1);

    // With tolerance 1 (budget 3), B11-16 (38-13-20, Δ=2) should appear.
    const widened = matchPlates(catalog, {
      seedType: 'Corn',
      series: 'B',
      cells: 16,
      shape: 'Flat',
      dimensions: { L: 38, D: 15, T: 20 },
      toleranceInternal: 1
    });
    expect(widened.length).toBeGreaterThan(exact.length);
    expect(widened.map((r) => r.plateNumber)).toContain('B11-16');
  });

  it('no dimensions → returns filtered pool sorted by plateNumber', () => {
    const res = matchPlates(catalog, {
      seedType: 'Soybean',
      series: 'B'
    });
    expect(res.every((r) => r.seedType === 'Soybean' && r.series === 'B')).toBe(true);
    const sorted = [...res.map((r) => r.plateNumber)].sort((a, b) => a.localeCompare(b));
    expect(res.map((r) => r.plateNumber)).toEqual(sorted);
  });

  it('shape filter is ignored for non-corn/soybean seed types', () => {
    // Sunflower plates have shape === '' in the catalog; passing shape='Round'
    // should still return all matches (the matcher only filters by shape on
    // corn/soybean per UC-41).
    const res = matchPlates(catalog, {
      seedType: 'Sunflower',
      shape: 'Round'
    });
    expect(res.length).toBeGreaterThan(0);
  });

  it('Sugar Beet returns empty (no records in catalog)', () => {
    const res = matchPlates(catalog, { seedType: 'Sugar Beet' });
    expect(res).toHaveLength(0);
  });

  it('limit caps the result count', () => {
    const res = matchPlates(catalog, { seedType: 'Corn', limit: 5 });
    expect(res.length).toBe(5);
  });
});

describe('cellCountRecommendation', () => {
  it('sparse spacing → 16-cell, low band', () => {
    // 30" rows × 12" in-row = 17,424 plants/acre → low.
    const rec = cellCountRecommendation(12, 30);
    expect(rec?.cells).toBe(16);
    expect(rec?.band).toBe('low');
    expect(rec?.plantsPerAcre).toBeLessThanOrEqual(22_000);
  });

  it('typical corn spacing (~28k plants/acre) → 24-cell, high band', () => {
    // 30" rows × 7.5" in-row ≈ 27,878 plants/acre → high (>= 26k).
    const rec = cellCountRecommendation(7.5, 30);
    expect(rec?.cells).toBe(24);
    expect(rec?.band).toBe('high');
  });

  it('middle band (22k–26k) prefers 24-cell for sprocket headroom', () => {
    // 30" rows × 9" in-row ≈ 23,232 plants/acre → mid.
    const rec = cellCountRecommendation(9, 30);
    expect(rec?.cells).toBe(24);
    expect(rec?.band).toBe('mid');
  });

  it('returns null when in-row spacing is missing or invalid', () => {
    expect(cellCountRecommendation(undefined, 30)).toBeNull();
    expect(cellCountRecommendation(0, 30)).toBeNull();
    expect(cellCountRecommendation(-1, 30)).toBeNull();
  });

  it('defaults row spacing to 30 inches', () => {
    const a = cellCountRecommendation(7.5, 30);
    const b = cellCountRecommendation(7.5, undefined);
    expect(a?.plantsPerAcre).toBe(b?.plantsPerAcre);
  });
});

describe('isLowConfidence', () => {
  it('flags no-dimensions case', () => {
    const res = matchPlates(catalog, { seedType: 'Corn', limit: 5 });
    const c = isLowConfidence(res, false);
    expect(c.lowConfidence).toBe(true);
  });

  it('flags empty results', () => {
    const c = isLowConfidence([], true);
    expect(c.lowConfidence).toBe(true);
  });

  it('approves a clean unique top match', () => {
    const res = matchPlates(catalog, {
      seedType: 'Corn',
      series: 'B',
      cells: 16,
      shape: 'Flat',
      dimensions: { L: 38, D: 15, T: 20 },
      toleranceInternal: 0
    });
    const c = isLowConfidence(res, true);
    expect(c.lowConfidence).toBe(false);
  });

  it('flags ties at the top', () => {
    // B6-16 (32-11-20) and B12-16 (36-12-20) — different deltas, so look for a
    // case with a true tie: B7-16 vs B12-16 both at 36-12-20. Δ to 36-12-20 is 0
    // for either. We have to pick a query where two plates share identical L/D/T.
    const res = matchPlates(catalog, {
      seedType: 'Corn',
      series: 'B',
      shape: 'Flat',
      dimensions: { L: 36, D: 12, T: 20 },
      toleranceInternal: 0
    });
    // B7-16, B7-24X, B12-16, B12-24 all live at 36-12-20.
    expect(res.length).toBeGreaterThanOrEqual(2);
    expect(res[0]?.delta).toBe(0);
    expect(res[1]?.delta).toBe(0);
    const c = isLowConfidence(res, true);
    expect(c.lowConfidence).toBe(true);
  });
});

describe('inferSeedTypeFromName', () => {
  it('maps common taxonomy names to seed types', () => {
    expect(inferSeedTypeFromName('Corn')).toBe('Corn');
    expect(inferSeedTypeFromName('Popcorn')).toBe('Corn');
    expect(inferSeedTypeFromName('Maize')).toBe('Corn');
    expect(inferSeedTypeFromName('Sorghum')).toBe('Sorghum');
    expect(inferSeedTypeFromName('Milo')).toBe('Sorghum');
    expect(inferSeedTypeFromName('Soybean')).toBe('Soybean');
    expect(inferSeedTypeFromName('Soya')).toBe('Soybean');
    expect(inferSeedTypeFromName('Sunflower')).toBe('Sunflower');
    expect(inferSeedTypeFromName('Sugar Beet')).toBe('Sugar Beet');
    expect(inferSeedTypeFromName('sugarbeet')).toBe('Sugar Beet');
  });

  it('returns null for unknown', () => {
    expect(inferSeedTypeFromName('Tomato')).toBeNull();
    expect(inferSeedTypeFromName('')).toBeNull();
    expect(inferSeedTypeFromName(null)).toBeNull();
  });
});

describe('unit conversion', () => {
  it('12mm ≈ 30 sixty-fourths', () => {
    // 12 × (64/25.4) = 30.236...
    expect(mmToInternal(12)).toBeCloseTo(30.24, 1);
  });
});

describe('CLASS_DEFAULT_DIMS_MM', () => {
  it('produces a usable match for every non-sugar-beet seed type', () => {
    // The class defaults must be within the matcher's tolerance budget for at
    // least one plate of the corresponding type — otherwise the AI-fallback
    // path silently fails. Tolerance is set generously (3mm per dim) so the
    // estimate doesn't have to be perfect.
    const TOLERANCE_MM = 3;
    const toleranceInternal = mmToInternal(TOLERANCE_MM);
    for (const seedType of ['Corn', 'Sorghum', 'Soybean', 'Sunflower'] as const) {
      const defaults = CLASS_DEFAULT_DIMS_MM[seedType];
      expect(defaults, `Missing class defaults for ${seedType}`).not.toBeNull();
      if (!defaults) continue;
      const matches = matchPlates(catalog, {
        seedType,
        shape:
          (seedType === 'Corn' || seedType === 'Soybean') && defaults.shape
            ? defaults.shape
            : 'Either',
        dimensions: {
          L: mmToInternal(defaults.L),
          D: mmToInternal(defaults.D),
          T: mmToInternal(defaults.T)
        },
        toleranceInternal,
        limit: 5
      });
      expect(matches.length, `No plates within tolerance for ${seedType} class defaults`).toBeGreaterThan(0);
    }
  });

  it('Sugar Beet is intentionally null (no catalog records)', () => {
    expect(CLASS_DEFAULT_DIMS_MM['Sugar Beet']).toBeNull();
  });
});
