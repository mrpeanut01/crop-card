/**
 * Phase 13b — geo/area unit tests.
 * Validates spherical-excess polygon area against known reference values.
 */

import { describe, expect, it } from 'vitest';
import { geojsonCentroid, haversineMeters, bearingDeg } from './area';
import { geojsonAreaAcres, metersSquaredToAcres, polygonAreaSqMeters } from './area';

const ACRES_PER_M2 = 0.000_247_105_381;

describe('polygonAreaSqMeters', () => {
  it('returns 0 for an open or sub-3-vertex ring', () => {
    expect(polygonAreaSqMeters([])).toBe(0);
    expect(
      polygonAreaSqMeters([
        [-77.6, 39.1],
        [-77.6, 39.1]
      ])
    ).toBe(0);
  });

  it('approximates a 1 km × 1 km square at 39° N within 0.5%', () => {
    // 1 km in longitude at 39° N ≈ 1 / (111.32 km/° * cos(39°)) ° ≈ 0.011582°
    // 1 km in latitude  ≈ 1 / 111.32 km/° ≈ 0.008989°
    const dLon = 1 / (111.32 * Math.cos((39 * Math.PI) / 180));
    const dLat = 1 / 111.32;
    const ring: Array<[number, number]> = [
      [-77.6, 39.1],
      [-77.6 + dLon, 39.1],
      [-77.6 + dLon, 39.1 + dLat],
      [-77.6, 39.1 + dLat],
      [-77.6, 39.1]
    ];
    const m2 = polygonAreaSqMeters(ring);
    const expected = 1_000 * 1_000;
    expect(Math.abs(m2 - expected) / expected).toBeLessThan(0.005);
  });

  it('returns the same area regardless of winding order', () => {
    const ring: Array<[number, number]> = [
      [-77.6, 39.1],
      [-77.59, 39.1],
      [-77.59, 39.11],
      [-77.6, 39.11],
      [-77.6, 39.1]
    ];
    const reversed = [...ring].reverse();
    expect(polygonAreaSqMeters(ring)).toBeCloseTo(polygonAreaSqMeters(reversed), 1);
  });
});

describe('metersSquaredToAcres', () => {
  it('matches the survey-acre conversion', () => {
    expect(metersSquaredToAcres(0)).toBe(0);
    expect(metersSquaredToAcres(4046.8564224)).toBeCloseTo(1, 4); // 1 acre = 4046.85 m²
    expect(metersSquaredToAcres(10_000)).toBeCloseTo(10_000 * ACRES_PER_M2, 6);
  });
});

describe('geojsonAreaAcres', () => {
  const polygon =
    '{"type":"Polygon","coordinates":[[[-77.60,39.10],[-77.59,39.10],[-77.59,39.11],[-77.60,39.11],[-77.60,39.10]]]}';

  it('parses a Polygon and returns positive acreage', () => {
    const acres = geojsonAreaAcres(polygon);
    expect(acres).not.toBeNull();
    expect(acres!).toBeGreaterThan(0);
  });

  it('parses a Feature wrapper and returns the same area as the bare Polygon', () => {
    const feature = `{"type":"Feature","geometry":${polygon},"properties":{}}`;
    expect(geojsonAreaAcres(feature)).toBeCloseTo(geojsonAreaAcres(polygon)!, 4);
  });

  it('parses a FeatureCollection and sums member polygons', () => {
    const fc = `{"type":"FeatureCollection","features":[{"type":"Feature","geometry":${polygon},"properties":{}},{"type":"Feature","geometry":${polygon},"properties":{}}]}`;
    expect(geojsonAreaAcres(fc)).toBeCloseTo(2 * geojsonAreaAcres(polygon)!, 4);
  });

  it('parses a MultiPolygon', () => {
    const mp = `{"type":"MultiPolygon","coordinates":[[[[-77.60,39.10],[-77.59,39.10],[-77.59,39.11],[-77.60,39.11],[-77.60,39.10]]]]}`;
    expect(geojsonAreaAcres(mp)).toBeCloseTo(geojsonAreaAcres(polygon)!, 4);
  });

  it('returns null for null / empty / garbage input', () => {
    expect(geojsonAreaAcres(null)).toBeNull();
    expect(geojsonAreaAcres('')).toBeNull();
    expect(geojsonAreaAcres('not json')).toBeNull();
    expect(geojsonAreaAcres('{"type":"LineString","coordinates":[]}')).toBeNull();
  });
});

describe('geojsonCentroid', () => {
  it('returns the area-weighted centroid of a polygon', () => {
    const square = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0]
        ]
      ]
    });
    const c = geojsonCentroid(square)!;
    expect(c[0]).toBeCloseTo(0.5, 4);
    expect(c[1]).toBeCloseTo(0.5, 4);
  });

  it('returns the midpoint of a 2-vertex LineString', () => {
    const line = JSON.stringify({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [10, 0]
      ]
    });
    const c = geojsonCentroid(line)!;
    expect(c[0]).toBeCloseTo(5, 4);
    expect(c[1]).toBeCloseTo(0, 4);
  });

  it('returns the length-weighted midpoint of a multi-segment LineString', () => {
    // 100 units along x, then 100 units along y → midpoint at (100, 0).
    const line = JSON.stringify({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [100, 0],
        [100, 100]
      ]
    });
    const c = geojsonCentroid(line)!;
    expect(c[0]).toBeCloseTo(100, 2);
    expect(c[1]).toBeCloseTo(0, 2);
  });

  it('returns the point itself for a Point geometry', () => {
    const point = JSON.stringify({ type: 'Point', coordinates: [-77.6, 39.09] });
    const c = geojsonCentroid(point)!;
    expect(c).toEqual([-77.6, 39.09]);
  });

  it('returns null for invalid or empty geometry', () => {
    expect(geojsonCentroid(null)).toBeNull();
    expect(geojsonCentroid('not json')).toBeNull();
    expect(geojsonCentroid('{"type":"LineString","coordinates":[[0,0]]}')).toBeNull();
  });
});

describe('haversineMeters + bearingDeg', () => {
  it('haversine: 1 degree of longitude at equator ≈ 111 km', () => {
    const d = haversineMeters([0, 0], [1, 0]);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('bearing east is 90°', () => {
    expect(bearingDeg([0, 39], [1, 39])).toBeCloseTo(90, 0);
  });

  it('bearing north is 0°', () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(0, 0);
  });
});
