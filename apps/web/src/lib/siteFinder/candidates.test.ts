import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { SoilLookup } from '$lib/soil/types';
import { survey } from './testSupport';
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
