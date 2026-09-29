import { describe, expect, it } from 'vitest';
import { areasNearPoint, distanceToAreaFt } from './nearbyAreas';
import { watererNamesFor, servedAreaIds } from './mapFeatures';

const FT_PER_DEG_LAT = 111_320 * 3.280_839_895;
const lat0 = 39.1;
const lon0 = -77.5;
const dLon = (ft: number) => ft / (FT_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180));
const dLat = (ft: number) => ft / FT_PER_DEG_LAT;

/** A square `size` ft on a side whose west edge sits `gapFt` east of the point. */
function squareEast(gapFt: number, size = 100): string {
  const x0 = lon0 + dLon(gapFt);
  const x1 = lon0 + dLon(gapFt + size);
  const y0 = lat0 - dLat(size / 2);
  const y1 = lat0 + dLat(size / 2);
  return JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0]
      ]
    ]
  });
}

describe('nearby Areas for a hydrant or waterer (#478)', () => {
  it('measures to the outline, and 0 inside it', () => {
    expect(distanceToAreaFt([lon0, lat0], squareEast(30))).toBeCloseTo(30, 0);
    expect(distanceToAreaFt([lon0, lat0], squareEast(-10))).toBe(0);
    expect(distanceToAreaFt([lon0, lat0], null)).toBeNull();
  });

  it('pre-checks Areas within 50 ft, nearest first, and skips undrawn ones', () => {
    const ids = areasNearPoint(
      [lon0, lat0],
      [
        { id: 'far', geometryGeojson: squareEast(80) },
        { id: 'next', geometryGeojson: squareEast(40) },
        { id: 'under', geometryGeojson: squareEast(-5) },
        { id: 'undrawn', geometryGeojson: null }
      ]
    );
    expect(ids).toEqual(['under', 'next']);
  });

  it('lists every hydrant that serves an Area, reading older bundles too', () => {
    const features = [
      { kind: 'hydrant' as const, name: 'North hydrant', fieldId: 'a', areaIds: ['a', 'b'] },
      { kind: 'hydrant' as const, name: 'Old one', fieldId: 'b' },
      { kind: 'gate' as const, name: 'Gate', fieldId: 'b', areaIds: ['b'] }
    ];
    expect(watererNamesFor('b', features)).toEqual(['North hydrant', 'Old one']);
    expect(watererNamesFor('a', features)).toEqual(['North hydrant']);
    expect(servedAreaIds({ fieldId: null })).toEqual([]);
  });
});
