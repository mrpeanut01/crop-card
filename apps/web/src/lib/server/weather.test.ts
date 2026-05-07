import { describe, expect, it } from 'vitest';
import { geometryCentroid } from './weather';

describe('geometryCentroid', () => {
  it('returns mean lat/lon for a Polygon ring', () => {
    const polygon = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [-77.6, 39.1],
          [-77.6, 39.2],
          [-77.5, 39.2],
          [-77.5, 39.1],
          [-77.6, 39.1]
        ]
      ]
    });
    const c = geometryCentroid(polygon);
    expect(c).not.toBeNull();
    expect(c!.lat).toBeCloseTo(39.16, 1);
    expect(c!.lon).toBeCloseTo(-77.56, 1);
  });

  it('handles a Feature wrapping the geometry', () => {
    const feat = JSON.stringify({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-77.6, 39.1],
            [-77.5, 39.1],
            [-77.5, 39.2],
            [-77.6, 39.2],
            [-77.6, 39.1]
          ]
        ]
      }
    });
    const c = geometryCentroid(feat);
    expect(c).not.toBeNull();
  });

  it('handles a MultiPolygon (uses outer ring of each polygon)', () => {
    const mp = JSON.stringify({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [-77.6, 39.1],
            [-77.5, 39.1],
            [-77.5, 39.2],
            [-77.6, 39.2],
            [-77.6, 39.1]
          ]
        ],
        [
          [
            [-77.4, 39.0],
            [-77.3, 39.0],
            [-77.3, 39.1],
            [-77.4, 39.1],
            [-77.4, 39.0]
          ]
        ]
      ]
    });
    const c = geometryCentroid(mp);
    expect(c).not.toBeNull();
    expect(c!.lat).toBeGreaterThan(38.9);
    expect(c!.lat).toBeLessThan(39.3);
  });

  it('returns null for malformed JSON', () => {
    expect(geometryCentroid('not json')).toBeNull();
  });

  it('returns null for unsupported geometry types', () => {
    const point = JSON.stringify({ type: 'Point', coordinates: [-77.6, 39.1] });
    expect(geometryCentroid(point)).toBeNull();
  });
});
