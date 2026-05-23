import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERIMETER_BUFFER_FT,
  footprintSqFt,
  plantsFitUsable,
  sufficiencyOf,
  usableSqft
} from './sufficiency';
import type { CropPlugin } from '$lib/plugins/schemas';

const SQFT_PER_ACRE = 43_560;
const FT_PER_DEGREE_LAT = 364_488;

function squareGeoJson(sideFt: number, anchorLat = 39, anchorLon = -77): string {
  const ftPerLon = FT_PER_DEGREE_LAT * Math.cos((anchorLat * Math.PI) / 180);
  const dLat = sideFt / FT_PER_DEGREE_LAT;
  const dLon = sideFt / ftPerLon;
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [anchorLon, anchorLat],
        [anchorLon, anchorLat + dLat],
        [anchorLon + dLon, anchorLat + dLat],
        [anchorLon + dLon, anchorLat],
        [anchorLon, anchorLat]
      ]
    ]
  });
}

function rectangleGeoJson(
  widthFt: number,
  heightFt: number,
  anchorLat = 39,
  anchorLon = -77
): string {
  const ftPerLon = FT_PER_DEGREE_LAT * Math.cos((anchorLat * Math.PI) / 180);
  const dLat = heightFt / FT_PER_DEGREE_LAT;
  const dLon = widthFt / ftPerLon;
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [anchorLon, anchorLat],
        [anchorLon, anchorLat + dLat],
        [anchorLon + dLon, anchorLat + dLat],
        [anchorLon + dLon, anchorLat],
        [anchorLon, anchorLat]
      ]
    ]
  });
}

describe('usableSqft — geometry inset', () => {
  it('insets a 60ft square by 3ft → 54×54 = 2916 sqft', () => {
    const result = usableSqft({ acres: undefined, geometryGeojson: squareGeoJson(60) });
    expect(result.source).toBe('geometry-inset');
    expect(result.geometryFallback).toBe(false);
    // Allow 2% slop from lat/lon projection rounding
    expect(result.sqft).toBeGreaterThan(54 * 54 * 0.98);
    expect(result.sqft).toBeLessThan(54 * 54 * 1.02);
  });

  it('insets a 100×40 rectangle by 3ft → 94×34 = 3196 sqft', () => {
    const result = usableSqft({ acres: undefined, geometryGeojson: rectangleGeoJson(40, 100) });
    expect(result.source).toBe('geometry-inset');
    expect(result.sqft).toBeGreaterThan(94 * 34 * 0.97);
    expect(result.sqft).toBeLessThan(94 * 34 * 1.03);
  });

  it('reports zero usable area for a 4ft × 100ft block at 3ft buffer (over-collapse)', () => {
    const result = usableSqft({ acres: undefined, geometryGeojson: rectangleGeoJson(4, 100) });
    expect(result.source).toBe('geometry-inset');
    expect(result.sqft).toBe(0);
  });

  it('honors a custom buffer', () => {
    const result = usableSqft({ acres: undefined, geometryGeojson: squareGeoJson(60) }, 10);
    // 40×40 = 1600 sqft
    expect(result.sqft).toBeGreaterThan(40 * 40 * 0.97);
    expect(result.sqft).toBeLessThan(40 * 40 * 1.03);
  });
});

describe('usableSqft — fallbacks', () => {
  it('falls back to acres × shrinkage when no geometry', () => {
    const result = usableSqft({ acres: 1.0, geometryGeojson: undefined });
    expect(result.source).toBe('acres-shrinkage');
    expect(result.sqft).toBeCloseTo(SQFT_PER_ACRE * 0.85, 0);
  });

  it('returns unknown when no acres and no geometry', () => {
    const result = usableSqft({ acres: undefined, geometryGeojson: undefined });
    expect(result.source).toBe('unknown');
    expect(result.sqft).toBe(0);
  });

  it('falls back to shrinkage on unparseable geometry', () => {
    const result = usableSqft({ acres: 0.5, geometryGeojson: 'not json' });
    expect(result.source).toBe('acres-shrinkage');
    expect(result.sqft).toBeCloseTo(0.5 * SQFT_PER_ACRE * 0.85, 0);
  });
});

describe('footprintSqFt — vine spread + canopy override', () => {
  it('takes max of row × in-row vs vine spread π·r² for a vining cucurbit', () => {
    const pumpkin: CropPlugin = {
      pluginId: 'pumpkin-monster',
      type: 'crop',
      displayName: 'Monster Pumpkin',
      version: '1.0.0',
      cropFamily: 'cucurbit',
      defaultRowSpacingInches: 96,
      plantingGuide: {
        rowSpacingIn: 96, // 8 ft
        inRowSpacingIn: { min: 36, max: 48 }, // avg 42 in = 3.5 ft
        vineSpreadFt: { min: 15, max: 20 } // π·10² = 314 sqft, vs 8×3.5=28 sqft
      },
      daysToMaturity: { min: 120, max: 130 }
    } as CropPlugin;
    expect(footprintSqFt(pumpkin)).toBeGreaterThan(300);
    expect(footprintSqFt(pumpkin)).toBeLessThan(330);
  });

  it('falls back to row × in-row when vine spread is absent', () => {
    const corn: CropPlugin = {
      pluginId: 'corn-x',
      type: 'crop',
      displayName: 'Corn',
      version: '1.0.0',
      cropFamily: 'corn',
      defaultRowSpacingInches: 36,
      plantingGuide: { rowSpacingIn: 36, inRowSpacingIn: { min: 9, max: 12 } },
      daysToMaturity: { min: 90, max: 100 }
    } as CropPlugin;
    // 36 in × 10.5 in avg = 3 ft × 0.875 ft = 2.625 sqft
    expect(footprintSqFt(corn)).toBeCloseTo(2.625, 2);
  });

  it('honours explicit matureCanopyFtSq when larger than row + vine', () => {
    const odd: CropPlugin = {
      pluginId: 'odd',
      type: 'crop',
      displayName: 'Odd',
      version: '1.0.0',
      cropFamily: 'corn',
      plantingGuide: {
        rowSpacingIn: 12,
        inRowSpacingIn: { min: 12, max: 12 },
        matureCanopyFtSq: 50
      },
      daysToMaturity: { min: 60, max: 70 }
    } as CropPlugin;
    expect(footprintSqFt(odd)).toBe(50);
  });
});

describe('plantsFitUsable', () => {
  it('uses the inset area for a square block with corn spacing (36×10.5)', () => {
    const corn: CropPlugin = {
      pluginId: 'corn',
      type: 'crop',
      displayName: 'Corn',
      version: '1.0.0',
      cropFamily: 'corn',
      defaultRowSpacingInches: 36,
      plantingGuide: { rowSpacingIn: 36, inRowSpacingIn: { min: 9, max: 12 } },
      daysToMaturity: { min: 90, max: 100 }
    } as CropPlugin;
    const block = { acres: 0.05, geometryGeojson: squareGeoJson(46.7) }; // 46.7² ≈ 2180 ≈ 0.05 ac
    const fit = plantsFitUsable(block, corn, DEFAULT_PERIMETER_BUFFER_FT);
    // 40.7×40.7 ≈ 1656 sqft / (3 × 0.875 = 2.625) = 631
    expect(fit).toBeGreaterThan(550);
    expect(fit).toBeLessThan(700);
  });
});

describe('sufficiencyOf', () => {
  it('classifies match within ±10% of utilisation', () => {
    expect(sufficiencyOf({ plantsAvailable: 100, plantsFit: 100 }).status).toBe('match');
    expect(sufficiencyOf({ plantsAvailable: 95, plantsFit: 100 }).status).toBe('match');
    expect(sufficiencyOf({ plantsAvailable: 105, plantsFit: 100 }).status).toBe('match');
  });

  it('classifies deficit below 90% utilisation', () => {
    const r = sufficiencyOf({ plantsAvailable: 50, plantsFit: 100 });
    expect(r.status).toBe('deficit');
    expect(r.utilizationPct).toBeCloseTo(0.5);
    expect(r.leftoverPlants).toBe(-50);
  });

  it('classifies surplus above 110% utilisation', () => {
    const r = sufficiencyOf({ plantsAvailable: 200, plantsFit: 100 });
    expect(r.status).toBe('surplus');
    expect(r.leftoverPlants).toBe(100);
  });

  it('handles zero capacity correctly', () => {
    expect(sufficiencyOf({ plantsAvailable: 100, plantsFit: 0 }).status).toBe('surplus');
    expect(sufficiencyOf({ plantsAvailable: 0, plantsFit: 0 }).status).toBe('match');
  });

  it('floors fractional inputs', () => {
    const r = sufficiencyOf({ plantsAvailable: 99.9, plantsFit: 100.5 });
    expect(r.plantsAvailable).toBe(99);
    expect(r.plantsFit).toBe(100);
  });
});
