import { describe, expect, it } from 'vitest';
import {
  bearingDegrees,
  blockDistanceFt,
  compassBearingFromTo,
  degreesToCompass16,
  hasGeometry,
  haversineFt
} from './distance';

/** Build a square polygon GeoJSON Feature centered at (lat, lon) with a
 *  given size in degrees on a side. Centroid of the square is exactly
 *  (lat, lon). */
function squareAt(lat: number, lon: number, sideDeg = 0.001): string {
  const half = sideDeg / 2;
  return JSON.stringify({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [lon - half, lat - half],
          [lon + half, lat - half],
          [lon + half, lat + half],
          [lon - half, lat + half],
          [lon - half, lat - half]
        ]
      ]
    }
  });
}

describe('haversineFt', () => {
  it('returns 0 for identical points', () => {
    expect(haversineFt(39, -77.6, 39, -77.6)).toBeCloseTo(0, 1);
  });
  it('matches known small distance — 0.001 deg lat at 39N is ~365ft', () => {
    // 1 degree of lat is ~364,000 ft; 0.001 deg is ~364 ft.
    const d = haversineFt(39.000, -77.6, 39.001, -77.6);
    expect(d).toBeGreaterThan(360);
    expect(d).toBeLessThan(370);
  });
  it('symmetric', () => {
    const a = haversineFt(39, -77.6, 39.01, -77.59);
    const b = haversineFt(39.01, -77.59, 39, -77.6);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('blockDistanceFt', () => {
  it('returns 0 for identical block id even without geometry', () => {
    expect(blockDistanceFt({ id: 'b1' }, { id: 'b1' })).toBe(0);
  });
  it('returns null when either block lacks geometry', () => {
    const a = { id: 'a', geometryGeojson: squareAt(39, -77.6) };
    const b = { id: 'b' };
    expect(blockDistanceFt(a, b)).toBeNull();
    expect(blockDistanceFt(b, a)).toBeNull();
  });
  it('returns ~365ft between two centroids 0.001 deg lat apart at 39N', () => {
    const a = { id: 'a', geometryGeojson: squareAt(39.000, -77.6) };
    const b = { id: 'b', geometryGeojson: squareAt(39.001, -77.6) };
    const d = blockDistanceFt(a, b)!;
    expect(d).toBeGreaterThan(360);
    expect(d).toBeLessThan(370);
  });
  it('returns ~250ft between centroids spaced ~0.000687 deg lat apart', () => {
    // ~250 / ~364,000 ft/deg ≈ 0.000687 deg lat
    const a = { id: 'a', geometryGeojson: squareAt(39.000, -77.6) };
    const b = { id: 'b', geometryGeojson: squareAt(39.000687, -77.6) };
    const d = blockDistanceFt(a, b)!;
    expect(d).toBeGreaterThan(245);
    expect(d).toBeLessThan(255);
  });
  it('returns null when geometry JSON is malformed', () => {
    const a = { id: 'a', geometryGeojson: 'not-json' };
    const b = { id: 'b', geometryGeojson: squareAt(39, -77.6) };
    expect(blockDistanceFt(a, b)).toBeNull();
  });
});

describe('hasGeometry', () => {
  it('true for a valid polygon, false for missing/malformed', () => {
    expect(hasGeometry({ id: 'a', geometryGeojson: squareAt(39, -77.6) })).toBe(true);
    expect(hasGeometry({ id: 'a' })).toBe(false);
    expect(hasGeometry({ id: 'a', geometryGeojson: 'garbage' })).toBe(false);
  });
});

describe('bearingDegrees + degreesToCompass16', () => {
  it('N when target is directly north (higher lat, same lon)', () => {
    expect(degreesToCompass16(bearingDegrees(39, -77.6, 39.01, -77.6))).toBe('N');
  });
  it('E when target is directly east (same lat, higher lon)', () => {
    expect(degreesToCompass16(bearingDegrees(39, -77.6, 39, -77.59))).toBe('E');
  });
  it('S when target is directly south', () => {
    expect(degreesToCompass16(bearingDegrees(39, -77.6, 38.99, -77.6))).toBe('S');
  });
  it('W when target is directly west', () => {
    expect(degreesToCompass16(bearingDegrees(39, -77.6, 39, -77.61))).toBe('W');
  });
  it('NE for a NE diagonal', () => {
    expect(degreesToCompass16(bearingDegrees(39, -77.6, 39.01, -77.59))).toBe('NE');
  });
  it('SW for a SW diagonal', () => {
    expect(degreesToCompass16(bearingDegrees(39, -77.6, 38.99, -77.61))).toBe('SW');
  });
  it('normalizes negative degrees', () => {
    expect(degreesToCompass16(-90)).toBe('W');
    expect(degreesToCompass16(450)).toBe('E');
  });
});

describe('compassBearingFromTo', () => {
  it('returns directional label for valid geometries', () => {
    const west = { id: 'w', geometryGeojson: squareAt(39, -77.61) };
    const east = { id: 'e', geometryGeojson: squareAt(39, -77.59) };
    expect(compassBearingFromTo(west, east)).toBe('E');
    expect(compassBearingFromTo(east, west)).toBe('W');
  });
  it('returns null when either block lacks geometry', () => {
    const east = { id: 'e', geometryGeojson: squareAt(39, -77.59) };
    expect(compassBearingFromTo({ id: 'a' }, east)).toBeNull();
  });
  it('returns null for same id (degenerate self-bearing)', () => {
    const east = { id: 'e', geometryGeojson: squareAt(39, -77.59) };
    expect(compassBearingFromTo(east, east)).toBeNull();
  });
});
