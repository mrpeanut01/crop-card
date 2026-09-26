import { describe, expect, it } from 'vitest';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import {
  buildGardenDesign,
  designFromSnapshot,
  designerHref,
  inSeason,
  landmarkRect,
  layoutBeds,
  type DesignBlockInput,
  type DesignInput,
  type DesignPlantingInput
} from './design';
import { canvasFromArea, rectsOverlap } from './geometry';

const canvas = canvasFromArea({
  id: 'a',
  name: 'Kitchen',
  widthFt: 20,
  lengthFt: 30,
  geojson: null
});

function block(over: Partial<DesignBlockInput>): DesignBlockInput {
  return {
    id: 'b',
    name: 'Bed',
    kind: 'bed',
    widthFt: 4,
    lengthFt: 8,
    xFt: null,
    yFt: null,
    rotationDeg: null,
    bedStyle: 'raised',
    ...over
  };
}

function planting(over: Partial<DesignPlantingInput>): DesignPlantingInput {
  return {
    id: 'p',
    blockId: 'b1',
    cropPluginId: 'lettuce',
    varietyDisplayName: 'Lettuce',
    status: 'planned',
    plantingDateMs: Date.UTC(2026, 3, 1),
    harvestedAtMs: null,
    footprint: null,
    spacingIn: null,
    rowSpacingIn: null,
    spacingPattern: null,
    plantCount: null,
    plantCountProvenance: null,
    groupId: null,
    groupSystemKind: null,
    ...over
  };
}

function input(over: Partial<DesignInput> = {}): DesignInput {
  return {
    area: { id: 'a', name: 'Kitchen', kind: 'garden', widthFt: 20, lengthFt: 30, geojson: null },
    blocks: [block({ id: 'b1', name: 'Bed 1', xFt: 2, yFt: 3 })],
    plantings: [],
    crops: {
      lettuce: {
        pluginId: 'lettuce',
        displayName: 'Lettuce',
        cropFamily: 'leafy-green',
        defaultRowSpacingInches: 12
      }
    },
    frost: {
      lastSpringFrostMs: Date.UTC(2026, 3, 15),
      firstFallFrostMs: Date.UTC(2026, 9, 15),
      provenance: 'fallback'
    },
    seasonYear: 2026,
    asOf: Date.UTC(2026, 4, 1),
    readOnlyReason: null,
    ...over
  };
}

describe('layoutBeds', () => {
  it('keeps stored positions and lays out the rest by free spot in name order', () => {
    const { beds, unplacedBedIds } = layoutBeds(
      [
        block({ id: 'b2', name: 'Bed 2' }),
        block({ id: 'b1', name: 'Bed 1', xFt: 0, yFt: 0 }),
        block({ id: 'b10', name: 'Bed 10' }),
        block({ id: 'row', name: 'Row', kind: 'row' })
      ],
      canvas
    );
    expect(beds.map((b) => b.blockId)).toEqual(['b1', 'b2', 'b10']);
    expect(unplacedBedIds).toEqual(['b2', 'b10']);
    expect(beds[0].rect).toMatchObject({ x: 0, y: 0, w: 4, l: 8 });
    for (let i = 0; i < beds.length; i++) {
      for (let j = i + 1; j < beds.length; j++) {
        expect(rectsOverlap(beds[i].rect, beds[j].rect)).toBe(false);
      }
    }
  });

  it('swaps the canvas box for a quarter turn and pulls a stray bed back inside', () => {
    const { beds } = layoutBeds([block({ id: 'b', xFt: 19, yFt: 29, rotationDeg: 90 })], canvas);
    expect(beds[0].rotationDeg).toBe(90);
    expect(beds[0].rect).toMatchObject({ x: 12, y: 26, w: 8, l: 4 });
  });

  it('gives containers and sizeless beds a default size', () => {
    const { beds } = layoutBeds(
      [
        block({ id: 'pot', kind: 'container', widthFt: null, lengthFt: null }),
        block({ id: 'bed', widthFt: null, lengthFt: null })
      ],
      canvas
    );
    expect(beds.find((b) => b.blockId === 'pot')).toMatchObject({ widthFt: 1, lengthFt: 1 });
    expect(beds.find((b) => b.blockId === 'bed')).toMatchObject({ widthFt: 4, lengthFt: 8 });
  });
});

describe('buildGardenDesign', () => {
  it('is null for Areas that are not gardens or greenhouses', () => {
    expect(buildGardenDesign(input({ area: { ...input().area, kind: 'field' } }))).toBeNull();
  });

  it('computes a count from spacing for placed plantings with fallback provenance', () => {
    const design = buildGardenDesign(
      input({
        plantings: [planting({ footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 48 } })]
      })
    )!;
    expect(design.plantings[0]).toMatchObject({ plantCount: 16, plantCountProvenance: 'fallback' });
    expect(design.crops.lettuce).toBeDefined();
    expect(design.readOnly).toBe(false);
  });

  it('keeps a typed count', () => {
    const design = buildGardenDesign(
      input({
        plantings: [
          planting({
            footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 48 },
            plantCount: 9,
            plantCountProvenance: 'manual'
          })
        ]
      })
    )!;
    expect(design.plantings[0]).toMatchObject({ plantCount: 9, plantCountProvenance: 'manual' });
  });

  it('leaves out plantings from other seasons, other blocks and archived rows', () => {
    const design = buildGardenDesign(
      input({
        plantings: [
          planting({ id: 'old', plantingDateMs: Date.UTC(2023, 4, 1) }),
          planting({ id: 'gone', status: 'archived' }),
          planting({ id: 'elsewhere', blockId: 'nope' }),
          planting({ id: 'undated', plantingDateMs: null }),
          planting({ id: 'now' })
        ]
      })
    )!;
    expect(design.plantings.map((p) => p.cropId)).toEqual(['now', 'undated']);
  });

  it('marks the design read-only with its reason', () => {
    const design = buildGardenDesign(input({ readOnlyReason: 'role' }))!;
    expect(design).toMatchObject({ readOnly: true, readOnlyReason: 'role' });
  });
});

describe('inSeason', () => {
  it('counts the season and the one before so overwintering crops still show', () => {
    expect(inSeason({ plantingDateMs: Date.UTC(2025, 9, 1), status: 'active' }, 2026)).toBe(true);
    expect(inSeason({ plantingDateMs: Date.UTC(2024, 9, 1), status: 'active' }, 2026)).toBe(false);
    expect(inSeason({ plantingDateMs: null, status: 'active' }, 2026)).toBe(false);
    expect(inSeason({ plantingDateMs: Date.UTC(2026, 3, 1), status: 'failed' }, 2026)).toBe(false);
  });
});

describe('designFromSnapshot', () => {
  const snap = sampleSnapshot();

  it('builds the kitchen garden from the offline snapshot', () => {
    const design = designFromSnapshot(snap, 'f_garden', {
      seasonYear: 2026,
      readOnlyReason: 'offline'
    })!;
    expect(design.canvas).toMatchObject({
      widthFt: 30,
      lengthFt: 40,
      source: 'dimensions',
      hasNorth: false
    });
    expect(design.beds.map((b) => b.blockId).sort()).toEqual(['b_bed1', 'b_bed3', 'b_pot']);
    expect(design.unplacedBedIds).toEqual(['b_pot']);
    expect(design.beds.find((b) => b.blockId === 'b_bed3')!.rect).toMatchObject({
      x: 14,
      y: 2,
      w: 8,
      l: 4
    });
    expect(design.plantings.map((p) => p.cropId)).toEqual(['p_tom', 'p_bean']);
    expect(design.plantings[0].plantingDateMs).toBe(Date.UTC(2026, 4, 4));
    expect(design).toMatchObject({
      readOnly: true,
      readOnlyReason: 'offline',
      asOf: snap.generatedAt
    });
    expect(design.frost.provenance).toBe('fallback');
  });

  it('reads footprints the snapshot carries', () => {
    const s = sampleSnapshot();
    s.plantings[0] = {
      ...s.plantings[0],
      footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 }
    } as (typeof s.plantings)[number];
    const design = designFromSnapshot(s, 'f_garden', { seasonYear: 2026, readOnlyReason: null })!;
    expect(design.plantings[0].footprint).toEqual({ x_in: 0, y_in: 0, w_in: 48, l_in: 96 });
  });

  it('is null for a missing or non-garden Area', () => {
    expect(designFromSnapshot(snap, 'nope', { seasonYear: 2026, readOnlyReason: null })).toBeNull();
    expect(
      designFromSnapshot(snap, 'f_hay', { seasonYear: 2026, readOnlyReason: null })
    ).toBeNull();
  });

  it('uses the snapshot frost dates', () => {
    const s = sampleSnapshot({
      frost: {
        lastSpring: '04-20',
        firstFall: '10-20',
        hardLastSpring: null,
        hardFirstFall: null,
        cautious: null,
        frostFree: false,
        provenance: 'data',
        stationName: null,
        distanceMi: null
      }
    });
    const design = designFromSnapshot(s, 'f_garden', { seasonYear: 2026, readOnlyReason: null })!;
    expect(design.frost).toEqual({
      lastSpringFrostMs: Date.UTC(2026, 3, 20),
      firstFallFrostMs: Date.UTC(2026, 9, 20),
      provenance: 'data'
    });
  });
});

describe('landmarkRect', () => {
  const square = (lon0: number, lat0: number, lon1: number, lat1: number) =>
    JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [lon0, lat0],
          [lon1, lat0],
          [lon1, lat1],
          [lon0, lat1],
          [lon0, lat0]
        ]
      ]
    });
  const area = square(-77.5, 39.0, -77.4999, 39.0001);
  const polyCanvas = canvasFromArea({
    id: 'a',
    name: 'A',
    widthFt: null,
    lengthFt: null,
    geojson: area
  });

  it('places a landmark in the west half of the Area from its map geometry', () => {
    const r = landmarkRect(area, square(-77.5, 39.0, -77.49995, 39.0001), polyCanvas)!;
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.w).toBeCloseTo(polyCanvas.widthFt / 2, 0);
    expect(r.l).toBeCloseTo(polyCanvas.lengthFt, 0);
  });

  it('is null without geometry or on a dimension-only canvas', () => {
    expect(landmarkRect(area, null, polyCanvas)).toBeNull();
    expect(landmarkRect(area, square(-77.5, 39.0, -77.49995, 39.0001), canvas)).toBeNull();
  });
});

describe('designerHref', () => {
  it('builds the route with optional bed, date and view', () => {
    expect(designerHref('f 1')).toBe('/plan/areas/f%201/design');
    expect(designerHref('a', { bedId: 'b1', onYmd: '2026-07-15', view: 'list' })).toBe(
      '/plan/areas/a/design?bed=b1&on=2026-07-15&view=list'
    );
  });
});
