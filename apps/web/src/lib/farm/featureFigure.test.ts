import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { layoutFarmFigure } from './featureFigure';
import { layoutMapOverlay } from '$lib/plan/mapOverlayLayout';

const square = (lon: number, lat: number, d = 0.001) =>
  JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [lon, lat],
        [lon + d, lat],
        [lon + d, lat + d],
        [lon, lat + d],
        [lon, lat]
      ]
    ]
  });

const field = {
  id: 'f1',
  name: 'Pasture',
  kind: 'pasture' as const,
  geometryGeojson: square(-77.55, 39.1)
};

describe('layoutFarmFigure', () => {
  it('matches the plain overlay when there are no lines or points', () => {
    const plain = layoutMapOverlay([field], []);
    expect(layoutFarmFigure([field], [], []).layout).toEqual(plain);
  });

  it('projects on the same plane as the Areas, so a gate on a corner sits on that corner', () => {
    const { layout, points } = layoutFarmFigure(
      [field],
      [],
      [
        {
          id: 'g',
          kind: 'gate',
          name: 'Gate',
          geometry: { type: 'Point', coordinates: [-77.55, 39.1] }
        }
      ]
    );
    const corner = layout.fields[0].rings[0][0];
    expect(points[0].x).toBeCloseTo(corner[0], 6);
    expect(points[0].y).toBeCloseTo(corner[1], 6);
  });

  it('grows the frame to include a fence that runs past the Areas', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.002, max: 0.05, noNaN: true }), (reach) => {
        const plain = layoutMapOverlay([field], []);
        const { layout, lines } = layoutFarmFigure(
          [field],
          [],
          [
            {
              id: 'fence',
              kind: 'fence',
              name: 'Fence',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [-77.55, 39.1],
                  [-77.55 + reach, 39.1]
                ]
              }
            }
          ]
        );
        expect(lines).toHaveLength(1);
        expect(layout.width).toBeGreaterThan(plain.width);
        for (const [x, y] of lines[0].points) {
          expect(x).toBeGreaterThanOrEqual(layout.minX - 1e-6);
          expect(x).toBeLessThanOrEqual(layout.minX + layout.width + 1e-6);
          expect(y).toBeGreaterThanOrEqual(layout.minY - 1e-6);
          expect(y).toBeLessThanOrEqual(layout.minY + layout.height + 1e-6);
        }
      })
    );
  });

  it('draws lines and points alone when no Area is drawn yet', () => {
    const { layout, points } = layoutFarmFigure(
      [],
      [],
      [
        {
          id: 'w',
          kind: 'water_source',
          name: 'Well',
          geometry: { type: 'Point', coordinates: [-77.5, 39] }
        }
      ]
    );
    expect(layout.mode).toBe('geometry');
    expect(points).toHaveLength(1);
    expect(layout.width).toBeGreaterThan(1);
  });

  it('never places lines or points on a farm sketched by size', () => {
    const sketched = {
      id: 's',
      name: 'Garden',
      kind: 'garden' as const,
      widthFt: 30,
      lengthFt: 40
    };
    const res = layoutFarmFigure(
      [sketched],
      [],
      [
        {
          id: 'g',
          kind: 'gate',
          name: 'Gate',
          geometry: { type: 'Point', coordinates: [-77.5, 39] }
        },
        { id: 'x', kind: 'hydrant', name: 'Hydrant', geometry: null }
      ]
    );
    expect(res.layout.mode).toBe('sketch');
    expect(res.lines).toEqual([]);
    expect(res.points).toEqual([]);
    expect(res.unplaced).toBe(1);
  });
});
