import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  LINE_FEATURE_KINDS,
  MAP_FEATURE_KINDS,
  MAP_FEATURE_LABELS,
  MAP_FEATURE_PLURAL,
  MAP_FEATURE_STYLE,
  POINT_FEATURE_KINDS,
  WATER_SOURCE_TYPES,
  describeFeature,
  featureCounts,
  geometryTypeFor,
  isMapFeatureKind,
  lineLengthFt,
  parseFeatureDetails,
  parseFeatureGeometry,
  validateFeatureDetails
} from './mapFeatures';

const noNegZero = (v: number) => (Object.is(v, -0) ? 0 : v);
const lon = fc.double({ min: -180, max: 180, noNaN: true }).map(noNegZero);
const lat = fc.double({ min: -90, max: 90, noNaN: true }).map(noNegZero);
const position = fc.tuple(lon, lat);

describe('map feature kinds', () => {
  it('splits every kind into exactly one of line or point', () => {
    const all = [...LINE_FEATURE_KINDS, ...POINT_FEATURE_KINDS].sort();
    expect(all).toEqual([...MAP_FEATURE_KINDS].sort());
    for (const k of LINE_FEATURE_KINDS) expect(geometryTypeFor(k)).toBe('LineString');
    for (const k of POINT_FEATURE_KINDS) expect(geometryTypeFor(k)).toBe('Point');
  });

  it('has a label, plural, color and printable color name for every kind', () => {
    for (const k of MAP_FEATURE_KINDS) {
      expect(MAP_FEATURE_LABELS[k]).toBeTruthy();
      expect(MAP_FEATURE_PLURAL[k]).toBeTruthy();
      expect(MAP_FEATURE_STYLE[k].color).toMatch(/^#[0-9a-f]{6}$/);
      expect(MAP_FEATURE_STYLE[k].colorName).toBeTruthy();
    }
    for (const k of POINT_FEATURE_KINDS) expect(MAP_FEATURE_STYLE[k].symbol).toMatch(/^[A-Z]$/);
  });

  it('never uses an em dash in user-facing words', () => {
    for (const k of MAP_FEATURE_KINDS) {
      expect(MAP_FEATURE_LABELS[k]).not.toContain('—');
      expect(MAP_FEATURE_STYLE[k].colorName).not.toContain('—');
    }
  });

  it('recognizes only known kinds', () => {
    expect(isMapFeatureKind('fence')).toBe(true);
    expect(isMapFeatureKind('watercourse')).toBe(false);
    expect(isMapFeatureKind(3)).toBe(false);
  });
});

describe('parseFeatureGeometry', () => {
  it('accepts any in-range point for point kinds and normalizes to 2D', () => {
    fc.assert(
      fc.property(fc.constantFrom(...POINT_FEATURE_KINDS), position, (kind, [x, y]) => {
        const res = parseFeatureGeometry(kind, { type: 'Point', coordinates: [x, y, 123] });
        expect(res).toEqual({ ok: true, geometry: { type: 'Point', coordinates: [x, y] } });
      })
    );
  });

  it('accepts lines with two or more distinct points, as object, string or Feature', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...LINE_FEATURE_KINDS),
        fc.uniqueArray(position, {
          minLength: 2,
          maxLength: 30,
          selector: ([x, y]) => `${x},${y}`
        }),
        fc.constantFrom('object', 'string', 'feature'),
        (kind, coords, wrap) => {
          const geom = { type: 'LineString', coordinates: coords };
          const input =
            wrap === 'string'
              ? JSON.stringify(geom)
              : wrap === 'feature'
                ? { type: 'Feature', properties: {}, geometry: geom }
                : geom;
          const res = parseFeatureGeometry(kind, input);
          expect(res.ok).toBe(true);
          if (res.ok) expect(res.geometry.coordinates).toEqual(coords);
        }
      )
    );
  });

  it('rejects the wrong geometry type for the kind', () => {
    fc.assert(
      fc.property(fc.constantFrom(...MAP_FEATURE_KINDS), position, (kind, p) => {
        const wrong =
          geometryTypeFor(kind) === 'Point'
            ? { type: 'LineString', coordinates: [p, [0, 0]] }
            : { type: 'Point', coordinates: p };
        expect(parseFeatureGeometry(kind, wrong).ok).toBe(false);
      })
    );
    expect(
      parseFeatureGeometry('fence', {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0]
          ]
        ]
      }).ok
    ).toBe(false);
  });

  it('rejects out-of-range, non-finite and degenerate coordinates', () => {
    const bad: unknown[] = [
      { type: 'Point', coordinates: [181, 0] },
      { type: 'Point', coordinates: [0, -91] },
      { type: 'Point', coordinates: [Number.NaN, 0] },
      { type: 'Point', coordinates: ['1', 2] },
      { type: 'Point', coordinates: [1] },
      { type: 'Point' },
      null,
      'not json',
      42
    ];
    for (const g of bad) expect(parseFeatureGeometry('gate', g).ok).toBe(false);
    expect(parseFeatureGeometry('path', { type: 'LineString', coordinates: [[1, 1]] }).ok).toBe(
      false
    );
    expect(
      parseFeatureGeometry('path', {
        type: 'LineString',
        coordinates: [
          [1, 1],
          [1, 1]
        ]
      }).ok
    ).toBe(false);
    expect(
      parseFeatureGeometry('path', {
        type: 'LineString',
        coordinates: [
          [1, 1],
          [200, 1]
        ]
      }).ok
    ).toBe(false);
  });

  it('refuses absurdly long lines', () => {
    const coords = Array.from({ length: 2001 }, (_, i) => [i * 1e-5, 0]);
    expect(parseFeatureGeometry('fence', { type: 'LineString', coordinates: coords }).ok).toBe(
      false
    );
  });
});

describe('lineLengthFt', () => {
  it('measures about 364,000 ft for one degree of latitude', () => {
    const ft = lineLengthFt({
      type: 'LineString',
      coordinates: [
        [-77.5, 39],
        [-77.5, 40]
      ]
    });
    expect(ft).toBeGreaterThan(363_000);
    expect(ft).toBeLessThan(365_500);
  });

  it('is null for points and additive over segments', () => {
    expect(lineLengthFt({ type: 'Point', coordinates: [0, 0] })).toBeNull();
    expect(lineLengthFt(null)).toBeNull();
    fc.assert(
      fc.property(
        fc.tuple(
          fc.double({ min: -77.6, max: -77.4, noNaN: true }),
          fc.double({ min: 39, max: 39.2, noNaN: true })
        ),
        fc.tuple(
          fc.double({ min: -77.6, max: -77.4, noNaN: true }),
          fc.double({ min: 39, max: 39.2, noNaN: true })
        ),
        (a, b) => {
          const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const direct = lineLengthFt({ type: 'LineString', coordinates: [a, b] }) ?? 0;
          const via = lineLengthFt({ type: 'LineString', coordinates: [a, mid, b] }) ?? 0;
          expect(Math.abs(direct - via)).toBeLessThanOrEqual(2);
        }
      )
    );
  });
});

describe('feature details', () => {
  it('accepts water source details and drops empty objects to null', () => {
    fc.assert(
      fc.property(
        fc.option(fc.constantFrom(...WATER_SOURCE_TYPES), { nil: undefined }),
        fc.option(fc.double({ min: 0.1, max: 5000, noNaN: true }), { nil: undefined }),
        (source, flowRateGpm) => {
          const res = validateFeatureDetails('water_source', { source, flowRateGpm });
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          if (source === undefined && flowRateGpm === undefined) expect(res.details).toBeNull();
          else expect(res.details).toEqual({ source, flowRateGpm });
        }
      )
    );
  });

  it('rejects bad water details and any details on other kinds', () => {
    expect(validateFeatureDetails('water_source', { source: 'creek' }).ok).toBe(false);
    expect(validateFeatureDetails('water_source', { flowRateGpm: 0 }).ok).toBe(false);
    expect(validateFeatureDetails('water_source', { flowRateGpm: -3 }).ok).toBe(false);
    expect(validateFeatureDetails('water_source', { flowRateGpm: 9999 }).ok).toBe(false);
    expect(validateFeatureDetails('water_source', { pressure: 40 }).ok).toBe(false);
    for (const k of MAP_FEATURE_KINDS.filter((k) => k !== 'water_source')) {
      expect(validateFeatureDetails(k, { source: 'well' }).ok).toBe(false);
      expect(validateFeatureDetails(k, {})).toEqual({ ok: true, details: null });
      expect(validateFeatureDetails(k, null)).toEqual({ ok: true, details: null });
    }
  });

  it('reads stored JSON and ignores rows that no longer validate', () => {
    expect(parseFeatureDetails('water_source', '{"source":"pond"}')).toEqual({ source: 'pond' });
    expect(parseFeatureDetails('water_source', '{"source":"lake"}')).toBeNull();
    expect(parseFeatureDetails('gate', '{"source":"well"}')).toBeNull();
    expect(parseFeatureDetails('gate', 'nope')).toBeNull();
    expect(parseFeatureDetails('gate', null)).toBeNull();
  });
});

describe('describeFeature and featureCounts', () => {
  it('reads plainly for lines, points and water sources', () => {
    expect(
      describeFeature({ kind: 'fence', name: 'Pasture fence', details: null, lengthFt: 1240 })
    ).toBe('Pasture fence · 1,240 ft');
    expect(
      describeFeature({ kind: 'gate', name: 'Lane gate', details: null, lengthFt: null })
    ).toBe('Lane gate');
    expect(
      describeFeature({
        kind: 'water_source',
        name: 'Barn well',
        details: { source: 'well', flowRateGpm: 12 },
        lengthFt: null
      })
    ).toBe('Barn well · Well, 12 gal/min');
    expect(describeFeature({ kind: 'hydrant', name: '  ', details: null, lengthFt: null })).toBe(
      'Hydrant'
    );
  });

  it('counts every kind, including zeros', () => {
    const counts = featureCounts([{ kind: 'fence' }, { kind: 'fence' }, { kind: 'gate' }]);
    expect(counts.get('fence')).toBe(2);
    expect(counts.get('gate')).toBe(1);
    expect(counts.get('path')).toBe(0);
    expect([...counts.keys()]).toEqual([...MAP_FEATURE_KINDS]);
  });
});
