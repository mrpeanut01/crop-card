import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { SoilLookup } from '$lib/soil/types';
import { spotLabel } from './explain';
import { planeGrid, survey } from './testSupport';
import {
  MAX_GRID_CELLS,
  MAX_SPOTS,
  findSpots,
  nearObstacle,
  rescoreWithSoil,
  whyBlocked,
  type FinderInput
} from './candidates';
import {
  boxAround,
  localFrame,
  pointInRing,
  rectOf,
  rectShapeDist,
  rectsOverlap,
  shapeToLocal,
  toLocal,
  toLonLat,
  type Rect,
  type XY
} from './geometry';
import {
  FALLBACK_SEASON,
  GOALS,
  PLANTING_GOALS,
  type AreaShape,
  type Candidate,
  type LonLat,
  type Obstacle
} from './types';

const CENTER: LonLat = [-77.7, 39.08];
const frame = localFrame(CENTER);
const ll = (p: XY) => toLonLat(frame, p);

const okSoil: SoilLookup = { status: 'ok', survey: survey() };

function square(id: string, kind: AreaShape['kind'], c: XY, half: number, areaId = id): AreaShape {
  return {
    id,
    areaId,
    name: id,
    kind,
    ring: (
      [
        [c[0] - half, c[1] - half],
        [c[0] + half, c[1] - half],
        [c[0] + half, c[1] + half],
        [c[0] - half, c[1] + half]
      ] as XY[]
    ).map(ll)
  };
}

function circle(id: string, kind: Obstacle['kind'], c: XY, radiusM: number): Obstacle {
  return {
    id,
    kind,
    shape: { type: 'circle', center: ll(c), radiusM },
    heightFt: 30,
    provenance: 'manual'
  };
}

function input(patch: Partial<FinderInput> = {}): FinderInput {
  return {
    goal: 'vegetable-garden',
    box: boxAround(CENTER, 60),
    footprint: { widthFt: 20, lengthFt: 30 },
    obstacles: [],
    areas: [],
    allowOverlapAreaIds: [],
    water: [],
    soil: okSoil,
    season: FALLBACK_SEASON,
    shadeChecked: false,
    ...patch
  };
}

function rectOfCandidate(c: Candidate): Rect {
  const pts = c.polygon.map((p) => toLocal(frame, p));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
}

const xy = fc.tuple(
  fc.double({ min: -28, max: 28, noNaN: true }),
  fc.double({ min: -28, max: 28, noNaN: true })
);

describe('findSpots', () => {
  it('returns up to three spots, best first, that do not overlap each other', () => {
    const out = findSpots(input());
    expect(out.candidates).toHaveLength(MAX_SPOTS);
    expect(out.tooBig).toBe(false);
    const rects = out.candidates.map(rectOfCandidate);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        // Shrink a hair so shared edges do not count.
        const a = { ...rects[i], minX: rects[i].minX + 0.01, maxX: rects[i].maxX - 0.01 };
        expect(rectsOverlap(a, rects[j])).toBe(false);
      }
    }
    const scores = out.candidates.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    for (const c of out.candidates) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(100);
      expect(c.polygon).toHaveLength(5);
      expect(c.polygon[0]).toEqual(c.polygon[4]);
    }
  });

  it('every spot lies inside the search box and has the asked size', () => {
    const out = findSpots(input());
    for (const c of out.candidates) {
      const r = rectOfCandidate(c);
      expect(r.minX).toBeGreaterThanOrEqual(-30 - 1e-6);
      expect(r.maxX).toBeLessThanOrEqual(30 + 1e-6);
      expect(r.minY).toBeGreaterThanOrEqual(-30 - 1e-6);
      expect(r.maxY).toBeLessThanOrEqual(30 + 1e-6);
      expect(r.maxX - r.minX).toBeCloseTo(20 * 0.3048, 4);
      expect(r.maxY - r.minY).toBeCloseTo(30 * 0.3048, 4);
    }
  });

  it('is the same for the same input, whatever order the inputs come in', () => {
    const areas = [square('barn', 'barn', [10, 10], 6), square('g', 'garden', [-12, 4], 5)];
    const obstacles = [circle('t1', 'tree', [-20, -20], 5), circle('b', 'building', [18, -15], 4)];
    const water = [
      { id: 'w1', name: 'Tap', point: ll([5, -25]) },
      { id: 'w2', name: 'Well', point: ll([-25, 25]) }
    ];
    const a = findSpots(input({ areas, obstacles, water, shadeChecked: true }));
    const b = findSpots(
      input({
        areas: [...areas].reverse(),
        obstacles: [...obstacles].reverse(),
        water: [...water].reverse(),
        shadeChecked: true
      })
    );
    expect(b).toEqual(a);
    expect(findSpots(input({ areas, obstacles, water, shadeChecked: true }))).toEqual(a);
  });

  it('never offers a spot on a blocked Area, a planted Area or a blocking obstacle', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            xy,
            fc.constantFrom(
              'barn',
              'residence',
              'water',
              'coop_pen',
              'natural_area',
              'garden',
              'field',
              'pasture'
            )
          ),
          { maxLength: 4 }
        ),
        fc.array(fc.tuple(xy, fc.constantFrom('building', 'water', 'pavement')), { maxLength: 4 }),
        (areaSpecs, obstacleSpecs) => {
          const areas = areaSpecs.map(([c, kind], i) =>
            square(`a${i}`, kind as AreaShape['kind'], c, 5)
          );
          const obstacles = obstacleSpecs.map(([c, kind], i) =>
            circle(`o${i}`, kind as Obstacle['kind'], c, 4)
          );
          const out = findSpots(input({ areas, obstacles, shadeChecked: true }));
          for (const cand of out.candidates) {
            const r = rectOfCandidate(cand);
            for (const a of areas) {
              const ring = a.ring.map((p) => toLocal(frame, p));
              expect(rectShapeDist(r, { type: 'polygon', ring })).toBeGreaterThan(0);
            }
            for (const o of obstacles) {
              expect(rectShapeDist(r, shapeToLocal(frame, o.shape))).toBeGreaterThan(0);
            }
          }
          expect(out.blocked).toBeLessThanOrEqual(out.considered);
        }
      ),
      { numRuns: 40 }
    );
  });

  it('a planted Area is open again when the owner allows the overlap, and says so', () => {
    const garden = square('area:g', 'garden', [0, 0], 40, 'g');
    const closed = findSpots(input({ areas: [garden] }));
    expect(closed.candidates).toHaveLength(0);
    expect(closed.blocked).toBe(closed.considered);
    const open = findSpots(input({ areas: [garden], allowOverlapAreaIds: ['g'] }));
    expect(open.candidates.length).toBeGreaterThan(0);
    expect(open.candidates[0].factors.find((f) => f.id === 'overlap')).toMatchObject({
      key: 'overlap.inside',
      provenance: 'manual'
    });
  });

  it('a barn is never open, whatever the owner allows', () => {
    const barn = square('area:b', 'barn', [0, 0], 40, 'b');
    expect(findSpots(input({ areas: [barn], allowOverlapAreaIds: ['b'] })).candidates).toEqual([]);
  });

  it('keeps spots inside a drawn property line', () => {
    const boundary = square('line', 'boundary', [-15, 0], 15);
    const out = findSpots(input({ areas: [boundary] }));
    expect(out.candidates.length).toBeGreaterThan(0);
    const ring = boundary.ring.map((p) => toLocal(frame, p));
    for (const c of out.candidates) {
      expect(pointInRing(toLocal(frame, c.center), ring)).toBe(true);
    }
  });

  it('says when the plot does not fit in the box', () => {
    const out = findSpots(input({ footprint: { widthFt: 400, lengthFt: 400 } }));
    expect(out).toMatchObject({ candidates: [], tooBig: true, considered: 0 });
  });

  it('keeps the grid within the cell cap for a small plot in a large box', () => {
    const out = findSpots(
      input({
        box: boxAround(CENTER, 120),
        footprint: { widthFt: 4, lengthFt: 8 },
        goal: 'herb-garden'
      })
    );
    expect(out.considered).toBeLessThanOrEqual(MAX_GRID_CELLS);
    expect(out.candidates).toHaveLength(MAX_SPOTS);
  });

  it('prefers the sunny side of a tree line and the spot near the tap', () => {
    const trees: Obstacle = {
      id: 'row',
      kind: 'tree-line',
      shape: { type: 'line', points: [ll([-30, -28]), ll([30, -28])], halfWidthM: 3 },
      heightFt: 70,
      provenance: 'manual'
    };
    const out = findSpots(input({ obstacles: [trees], shadeChecked: true }));
    expect(toLocal(frame, out.candidates[0].center)[1]).toBeGreaterThan(-10);
    const tap = findSpots(input({ water: [{ id: 'w', name: 'Tap', point: ll([25, 25]) }] }));
    const best = toLocal(frame, tap.candidates[0].center);
    expect(best[0]).toBeGreaterThan(0);
    expect(best[1]).toBeGreaterThan(0);
  });

  it('works for every goal', () => {
    for (const goal of PLANTING_GOALS) {
      const out = findSpots(
        input({ goal, box: boxAround(CENTER, 100), footprint: { widthFt: 10, lengthFt: 10 } })
      );
      expect(out.candidates.length).toBeGreaterThan(0);
    }
  });
});

describe('rescoreWithSoil', () => {
  it('scores each spot with its own survey and puts the best first', () => {
    const base = findSpots(input());
    const wet: SoilLookup = { status: 'ok', survey: survey({ drainageClass: 'very-poorly' }) };
    const out = rescoreWithSoil(input(), base.candidates, new Map([[base.candidates[0].id, wet]]));
    expect(out).toHaveLength(base.candidates.length);
    expect(out[out.length - 1].id).toBe(base.candidates[0].id);
    expect(out[out.length - 1].score).toBeLessThan(base.candidates[0].score);
    expect(rescoreWithSoil(input(), base.candidates, new Map())).toEqual(base.candidates);
  });
});

describe('whyBlocked and nearObstacle', () => {
  it('gives the engine reason for a point', () => {
    const inp = input({
      areas: [square('barn', 'barn', [20, 20], 5), square('line', 'boundary', [0, 0], 28)],
      obstacles: [circle('pond', 'water', [-20, -20], 4)]
    });
    expect(whyBlocked(inp, ll([0, 0]))).toBeNull();
    expect(whyBlocked(inp, ll([20, 20]))).toBe('area');
    expect(whyBlocked(inp, ll([-20, -20]))).toBe('obstacle');
    expect(whyBlocked(inp, ll([29, 0]))).toBe('outside-box');
    expect(
      whyBlocked(input({ areas: [square('line', 'boundary', [-20, 0], 8)] }), ll([10, 0]))
    ).toBe('outside-boundary');
  });

  it('finds a point on or beside an obstacle', () => {
    const box = boxAround(CENTER, 60);
    const o = [circle('t', 'tree', [5, 5], 3)];
    expect(nearObstacle(box, ll([5, 5]), o, 0)).toBe(true);
    expect(nearObstacle(box, ll([10, 5]), o, 3)).toBe(true);
    expect(nearObstacle(box, ll([20, 5]), o, 3)).toBe(false);
    expect(rectOf([0, 0], 2, 2)).toBeTruthy();
  });
});

describe('sloping ground', () => {
  const box = boxAround(CENTER, 60);
  const onSlope = (slopePct: number, aspectDeg: number, patch: Partial<FinderInput> = {}) =>
    findSpots(
      input({ terrain: { grid: planeGrid(box, slopePct, aspectDeg), ownerSlopes: [] }, ...patch })
    );
  const factor = (c: Candidate, id: string) => c.factors.find((f) => f.id === id);

  it('with no terrain every spot is exactly what it was on level ground', () => {
    const before = findSpots(input({ obstacles: [circle('t', 'tree', [10, -12], 5)] }));
    for (const terrain of [null, undefined, { grid: null, ownerSlopes: [] }]) {
      const got = findSpots(input({ obstacles: [circle('t', 'tree', [10, -12], 5)], terrain }));
      expect(got).toEqual(before);
    }
    expect(before.candidates.every((c) => !c.factors.some((f) => f.id === 'facing'))).toBe(true);
    expect(factor(before.candidates[0], 'slope')).toMatchObject({ key: 'slope.flat' });
  });

  it('says which way each spot faces, from the elevation grid', () => {
    const north = onSlope(12, 0);
    expect(north.candidates).toHaveLength(MAX_SPOTS);
    for (const c of north.candidates) {
      expect(factor(c, 'slope')).toMatchObject({
        key: 'slope.here.moderate',
        provenance: 'data',
        source: 'elevation'
      });
      expect(factor(c, 'facing')).toMatchObject({
        key: 'facing.north',
        params: { dir: 'n' },
        verdict: 'ok',
        provenance: 'data',
        source: 'elevation'
      });
      // The sun line itself stays an app estimate.
      expect(factor(c, 'sun')).toMatchObject({ provenance: 'fallback' });
    }
    expect(factor(onSlope(12, 180).candidates[0], 'facing')).toMatchObject({
      key: 'facing.south',
      verdict: 'good'
    });
    expect(factor(onSlope(12, 90).candidates[0], 'facing')?.key).toBe('facing.east');
    expect(factor(onSlope(12, 270).candidates[0], 'facing')?.key).toBe('facing.west');
  });

  it('level ground from the grid has the slope line and no facing line', () => {
    const level = onSlope(1, 45).candidates[0];
    expect(factor(level, 'slope')).toMatchObject({ key: 'slope.here.flat', source: 'elevation' });
    expect(factor(level, 'facing')).toBeUndefined();
  });

  it('turning the same slope from north-facing to south-facing never lowers the score', () => {
    const goals = PLANTING_GOALS.filter((g) => GOALS[g].weights.facing > 0);
    fc.assert(
      fc.property(
        fc.constantFrom(...goals),
        fc.double({ min: 2, max: 40, noNaN: true }),
        fc.array(fc.tuple(xy, fc.double({ min: 1, max: 6, noNaN: true })), { maxLength: 3 }),
        (goal, slopePct, trees) => {
          const obstacles = trees.map(([c, r], i) => circle(`t${i}`, 'tree', c, r));
          const footprint = GOALS[goal].defaultFootprint;
          const size = goal === 'fruit-trees' ? 120 : 60;
          const b = boxAround(CENTER, size);
          const run = (aspectDeg: number) =>
            findSpots(
              input({
                goal,
                box: b,
                footprint,
                obstacles,
                shadeChecked: true,
                terrain: { grid: planeGrid(b, slopePct, aspectDeg), ownerSlopes: [] }
              })
            );
          const north = run(0);
          const south = run(180);
          const southById = new Map(south.candidates.map((c) => [c.id, c]));
          // The best south-facing spot is at least as good as the best
          // north-facing one, and so is each spot both runs offer.
          if (north.candidates.length > 0) {
            expect(south.candidates[0].score).toBeGreaterThanOrEqual(north.candidates[0].score);
          }
          for (const n of north.candidates) {
            const same = southById.get(n.id);
            if (same) expect(same.score).toBeGreaterThanOrEqual(n.score);
          }
        }
      ),
      { numRuns: 30 }
    );
  });

  it('a steep north-facing spot is never the best match, however well the rest scores', () => {
    const steep = onSlope(25, 0);
    for (const [rank, c] of steep.candidates.entries()) {
      expect(factor(c, 'facing')?.verdict).toBe('poor');
      expect(
        spotLabel(
          c.score,
          rank,
          c.factors.some((f) => f.verdict === 'poor')
        )
      ).toBe('look');
    }
  });

  it("the owner's own slope for a drawn block wins, tagged manual", () => {
    const got = findSpots(
      input({
        terrain: {
          grid: planeGrid(box, 20, 0),
          ownerSlopes: [
            {
              id: 'b1',
              ring: square('b1', 'field', [0, 0], 29.9).ring,
              slopePct: 5,
              aspectDeg: 180
            }
          ]
        }
      })
    );
    const inside = got.candidates.find((c) => factor(c, 'slope')?.provenance === 'manual');
    expect(inside).toBeDefined();
    expect(factor(inside!, 'slope')).toMatchObject({ key: 'slope.here.gentle' });
    expect(factor(inside!, 'slope')?.source).toBeUndefined();
    expect(factor(inside!, 'facing')).toMatchObject({ key: 'facing.south', provenance: 'manual' });
  });

  it('with only owner values, a spot outside the block is level ground as before', () => {
    const got = findSpots(
      input({
        terrain: {
          grid: null,
          ownerSlopes: [
            { id: 'b1', ring: square('b1', 'field', [-20, 0], 9).ring, slopePct: 9, aspectDeg: 0 }
          ]
        }
      })
    );
    const outside = got.candidates.filter((c) => factor(c, 'slope')?.key === 'slope.flat');
    expect(outside.length).toBeGreaterThan(0);
    for (const c of outside) expect(factor(c, 'facing')).toBeUndefined();
  });

  it('rescoring with the soil at each spot keeps the terrain', () => {
    const inp = input({ terrain: { grid: planeGrid(box, 12, 0), ownerSlopes: [] } });
    const first = findSpots(inp);
    const again = rescoreWithSoil(inp, first.candidates, new Map());
    expect(again).toEqual(first.candidates);
  });
});
