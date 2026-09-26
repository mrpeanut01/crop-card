import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  AREA_DETAILS_SCHEMAS,
  AREA_KIND_LABELS,
  AREA_KINDS,
  BED_STYLES,
  BLOCK_KIND_LABELS,
  BLOCK_KINDS,
  CROP_AREA_KINDS,
  OTHER_AREA_KINDS,
  areaKindWithDetailsSchema,
  blockKindsFor,
  defaultBlockKindFor,
  isAreaKind,
  isBlockKind,
  isCropBearing,
  isDesignable,
  normalizeRotationDeg,
  parseAreaDetails,
  perimeterFtFor,
  perimeterFtFromDimensions,
  perimeterFtFromGeojson,
  usesDesignerLayout,
  validateAreaDetails,
  type AreaKind
} from './areaKinds';
import { blocks, crops, fields } from '$lib/db/schema';
import { PLANT_COUNT_PROVENANCES, SPACING_PATTERNS } from './footprint';

describe('area kinds', () => {
  it('splits into crop-bearing and other areas with no overlap', () => {
    expect(AREA_KINDS).toHaveLength(10);
    expect(new Set(AREA_KINDS).size).toBe(AREA_KINDS.length);
    for (const k of CROP_AREA_KINDS) expect(isCropBearing(k)).toBe(true);
    for (const k of OTHER_AREA_KINDS) expect(isCropBearing(k)).toBe(false);
  });

  it('only gardens and greenhouses open in the designer', () => {
    expect(AREA_KINDS.filter(isDesignable)).toEqual(['garden', 'greenhouse']);
  });

  it('DB values are stable lowercase identifiers', () => {
    for (const k of [...AREA_KINDS, ...BLOCK_KINDS, ...BED_STYLES]) {
      expect(k).toMatch(/^[a-z][a-z_-]*$/);
    }
  });

  it('labels never read as "{kind} area" and natural_area is "Woods / natural"', () => {
    for (const k of AREA_KINDS) expect(AREA_KIND_LABELS[k]).not.toMatch(/\barea\b/i);
    expect(AREA_KIND_LABELS.natural_area).toBe('Woods / natural');
    for (const k of BLOCK_KINDS) expect(BLOCK_KIND_LABELS[k]).toBeTruthy();
  });

  it('matches the enums declared on the Drizzle columns', () => {
    expect([...fields.kind.enumValues]).toEqual([...AREA_KINDS]);
    expect([...blocks.kind.enumValues]).toEqual([...BLOCK_KINDS]);
    expect([...(blocks.bedStyle.enumValues ?? [])]).toEqual([...BED_STYLES]);
    expect([...(crops.spacingPattern.enumValues ?? [])]).toEqual([...SPACING_PATTERNS]);
    expect([...(crops.plantCountProvenance.enumValues ?? [])]).toEqual([
      ...PLANT_COUNT_PROVENANCES
    ]);
  });

  it('type guards accept only known values', () => {
    expect(isAreaKind('garden')).toBe(true);
    expect(isAreaKind('Garden')).toBe(false);
    expect(isAreaKind('location')).toBe(false);
    expect(isAreaKind(3)).toBe(false);
    expect(isBlockKind('bed')).toBe(true);
    expect(isBlockKind('plot')).toBe(false);
  });
});

describe('area details', () => {
  it('has a schema for every kind', () => {
    for (const k of AREA_KINDS) expect(AREA_DETAILS_SCHEMAS[k]).toBeDefined();
  });

  it('accepts each kind-specific shape', () => {
    const good: Array<[AreaKind, unknown]> = [
      [
        'garden',
        { organicStatus: 'transitional', transitionDate: '2026-04-01', irrigation: 'drip' }
      ],
      [
        'greenhouse',
        {
          organicStatus: 'organic',
          heated: true,
          supplementalLight: false,
          structure: 'high-tunnel'
        }
      ],
      ['orchard', { rowSpacingFt: 18, treeSpacingFt: 12 }],
      ['pasture', { use: 'both' }],
      ['barn', { washPack: true, coldStorage: false, chemicalStorage: true }],
      ['water', { usedForIrrigation: true }],
      ['field', {}],
      ['boundary', {}]
    ];
    for (const [kind, details] of good) {
      expect(validateAreaDetails(kind, details).ok, kind).toBe(true);
      expect(areaKindWithDetailsSchema.safeParse({ kind, details }).success, kind).toBe(true);
    }
  });

  it('rejects details that belong to another kind', () => {
    expect(validateAreaDetails('pasture', { heated: true }).ok).toBe(false);
    expect(validateAreaDetails('field', { use: 'hay' }).ok).toBe(false);
    expect(validateAreaDetails('residence', { washPack: true }).ok).toBe(false);
    expect(
      areaKindWithDetailsSchema.safeParse({ kind: 'barn', details: { use: 'graze' } }).success
    ).toBe(false);
  });

  it('rejects bad values within the right kind', () => {
    expect(validateAreaDetails('garden', { irrigation: 'flood' }).ok).toBe(false);
    expect(validateAreaDetails('garden', { transitionDate: '4/1/2026' }).ok).toBe(false);
    expect(validateAreaDetails('garden', { transitionDate: '2026-13-45' }).ok).toBe(false);
    expect(validateAreaDetails('garden', { transitionDate: '2026-02-30' }).ok).toBe(false);
    expect(validateAreaDetails('orchard', { rowSpacingFt: -3 }).ok).toBe(false);
    expect(validateAreaDetails('greenhouse', { heated: 'yes' }).ok).toBe(false);
    expect(validateAreaDetails('garden', 'drip').ok).toBe(false);
  });

  it('rejects an unknown kind in the union', () => {
    expect(areaKindWithDetailsSchema.safeParse({ kind: 'location', details: {} }).success).toBe(
      false
    );
  });

  it('normalizes empty and missing details to null', () => {
    expect(validateAreaDetails('garden', {})).toEqual({ ok: true, details: null });
    expect(validateAreaDetails('garden', null)).toEqual({ ok: true, details: null });
    expect(validateAreaDetails('garden', undefined)).toEqual({ ok: true, details: null });
  });

  it('parses stored JSON and drops what no longer fits the kind', () => {
    const json = JSON.stringify({ irrigation: 'hose' });
    expect(parseAreaDetails('garden', json)).toEqual({ irrigation: 'hose' });
    expect(parseAreaDetails('pasture', json)).toBeNull();
    expect(parseAreaDetails('garden', '{not json')).toBeNull();
    expect(parseAreaDetails('garden', null)).toBeNull();
  });
});

describe('block kinds', () => {
  it('beds and containers use the designer grid; blocks and rows do not', () => {
    expect(BLOCK_KINDS.filter(usesDesignerLayout)).toEqual(['bed', 'container']);
  });

  it('defaults new blocks by parent Area kind', () => {
    expect(defaultBlockKindFor('garden')).toBe('bed');
    expect(defaultBlockKindFor('greenhouse')).toBe('bed');
    expect(defaultBlockKindFor('orchard')).toBe('row');
    expect(defaultBlockKindFor('field')).toBe('block');
    expect(defaultBlockKindFor('barn')).toBe('block');
    expect(blockKindsFor('water')).toEqual([]);
  });

  it('crop-bearing areas allow at least one block kind', () => {
    for (const k of CROP_AREA_KINDS) expect(blockKindsFor(k).length).toBeGreaterThan(0);
  });
});

describe('normalizeRotationDeg', () => {
  it('snaps to 90° steps in [0, 360)', () => {
    expect(normalizeRotationDeg(0)).toBe(0);
    expect(normalizeRotationDeg(90)).toBe(90);
    expect(normalizeRotationDeg(360)).toBe(0);
    expect(normalizeRotationDeg(-90)).toBe(270);
    expect(normalizeRotationDeg(44)).toBe(0);
    expect(normalizeRotationDeg(46)).toBe(90);
    expect(normalizeRotationDeg(Number.NaN)).toBe(0);
  });

  it('is idempotent and always a legal step', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (d) => {
        const r = normalizeRotationDeg(d);
        expect([0, 90, 180, 270]).toContain(r);
        expect(normalizeRotationDeg(r)).toBe(r);
      })
    );
  });

  it('four quarter turns return to the start', () => {
    fc.assert(
      fc.property(fc.constantFrom(0, 90, 180, 270), (r) => {
        let cur: number = r;
        for (let i = 0; i < 4; i++) cur = normalizeRotationDeg(cur + 90);
        expect(cur).toBe(r);
      })
    );
  });
});

describe('perimeter', () => {
  it('from dimensions is 2(w + l)', () => {
    expect(perimeterFtFromDimensions(4, 8)).toBe(24);
    expect(perimeterFtFromDimensions(30, 40)).toBe(140);
    expect(perimeterFtFromDimensions(0, 8)).toBeNull();
    expect(perimeterFtFromDimensions(4, null)).toBeNull();
  });

  it('from dimensions is symmetric and grows with either side', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 5000, noNaN: true }),
        fc.double({ min: 0.5, max: 5000, noNaN: true }),
        fc.double({ min: 0.5, max: 100, noNaN: true }),
        (w, l, d) => {
          const p = perimeterFtFromDimensions(w, l)!;
          expect(p).toBe(perimeterFtFromDimensions(l, w));
          expect(perimeterFtFromDimensions(w + d, l)!).toBeGreaterThanOrEqual(p);
        }
      )
    );
  });

  // ~100 m square near Leesburg, VA.
  const lat = 39.1;
  const lon = -77.56;
  const dLat = 100 / 111_320;
  const dLon = 100 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const square = {
    type: 'Polygon',
    coordinates: [
      [
        [lon, lat],
        [lon + dLon, lat],
        [lon + dLon, lat + dLat],
        [lon, lat + dLat],
        [lon, lat]
      ]
    ]
  };

  it('from GeoJSON matches a surveyed square within 1%', () => {
    const expected = 400 * 3.280_839_895;
    const p = perimeterFtFromGeojson(JSON.stringify(square))!;
    expect(Math.abs(p - expected) / expected).toBeLessThan(0.01);
  });

  it('handles Feature, FeatureCollection and MultiPolygon', () => {
    const one = perimeterFtFromGeojson(JSON.stringify(square))!;
    expect(
      perimeterFtFromGeojson(JSON.stringify({ type: 'Feature', geometry: square, properties: {} }))
    ).toBe(one);
    expect(
      perimeterFtFromGeojson(
        JSON.stringify({
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: square }]
        })
      )
    ).toBe(one);
    const multi = perimeterFtFromGeojson(
      JSON.stringify({
        type: 'MultiPolygon',
        coordinates: [square.coordinates, square.coordinates]
      })
    )!;
    expect(multi).toBeCloseTo(one * 2, 0);
  });

  it('returns null for missing or unusable geometry', () => {
    expect(perimeterFtFromGeojson(null)).toBeNull();
    expect(perimeterFtFromGeojson('nope')).toBeNull();
    expect(
      perimeterFtFromGeojson(JSON.stringify({ type: 'Point', coordinates: [0, 0] }))
    ).toBeNull();
    expect(
      perimeterFtFromGeojson(
        JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [1, 1]
            ]
          ]
        })
      )
    ).toBeNull();
    expect(
      perimeterFtFromGeojson(
        JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              ['a', 1],
              [1, 1],
              [0, 0]
            ]
          ]
        })
      )
    ).toBeNull();
  });

  it('prefers drawn geometry over sketch dimensions, like acres', () => {
    const geo = JSON.stringify(square);
    expect(perimeterFtFor({ geometryGeojson: geo, widthFt: 4, lengthFt: 8 })).toBe(
      perimeterFtFromGeojson(geo)
    );
    expect(perimeterFtFor({ geometryGeojson: null, widthFt: 4, lengthFt: 8 })).toBe(24);
    expect(perimeterFtFor({})).toBeNull();
  });
});
