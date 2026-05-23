/**
 * Regression test for the "create block with manual acres → draw polygon →
 * acres still showing the manual value" bug. The fix is in `effectiveAcresFor`
 * and the read-side override in `rowToBlock` — geometry wins when present.
 */

import { describe, expect, it } from 'vitest';
import { effectiveAcresFor } from './blocks';

const SQUARE_HALF_ACRE_GEO = JSON.stringify({
  type: 'Polygon',
  coordinates: [
    // ~146.97 ft on a side ≈ 21,600 ft² ≈ 0.4959 ac at 39° latitude
    [
      [-77.0, 39.0],
      [-77.0, 39.0 + 146.97 / 364488],
      [-77.0 + 146.97 / (364488 * Math.cos((39 * Math.PI) / 180)), 39.0 + 146.97 / 364488],
      [-77.0 + 146.97 / (364488 * Math.cos((39 * Math.PI) / 180)), 39.0],
      [-77.0, 39.0]
    ]
  ]
});

describe('effectiveAcresFor', () => {
  it('returns geometry-derived acres when geometry is present, even if manual acres differs', () => {
    const result = effectiveAcresFor({ acres: 0.1, geometryGeojson: SQUARE_HALF_ACRE_GEO });
    expect(result).toBeGreaterThan(0.45);
    expect(result).toBeLessThan(0.55);
  });

  it('returns geometry-derived acres when manual acres is null/undefined', () => {
    expect(
      effectiveAcresFor({ acres: null, geometryGeojson: SQUARE_HALF_ACRE_GEO })
    ).toBeGreaterThan(0);
    expect(
      effectiveAcresFor({ acres: undefined, geometryGeojson: SQUARE_HALF_ACRE_GEO })
    ).toBeGreaterThan(0);
  });

  it('falls back to manual acres when no geometry', () => {
    expect(effectiveAcresFor({ acres: 0.5, geometryGeojson: null })).toBe(0.5);
    expect(effectiveAcresFor({ acres: 0.5, geometryGeojson: undefined })).toBe(0.5);
  });

  it('falls back to manual acres when geometry is unparseable', () => {
    expect(effectiveAcresFor({ acres: 0.5, geometryGeojson: 'not json' })).toBe(0.5);
  });

  it('falls back to manual acres when geometry has zero area (degenerate polygon)', () => {
    const degenerate = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [-77.0, 39.0],
          [-77.0, 39.0],
          [-77.0, 39.0],
          [-77.0, 39.0]
        ]
      ]
    });
    expect(effectiveAcresFor({ acres: 0.5, geometryGeojson: degenerate })).toBe(0.5);
  });

  it('returns undefined when neither geometry nor manual acres is set', () => {
    expect(effectiveAcresFor({ acres: null, geometryGeojson: null })).toBeUndefined();
    expect(effectiveAcresFor({ acres: undefined, geometryGeojson: undefined })).toBeUndefined();
  });
});
