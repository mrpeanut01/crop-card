import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { boxAround, boxCenter, localFrame, rectOf, toLocal, toLonLat, type XY } from './geometry';
import {
  FLAT_SLOPE_PCT,
  TERRAIN_GRID_N,
  compassOf,
  fitPlane,
  gridPoints,
  slopeOfPlane,
  spotTerrain,
  spotTerrainFromGrid,
  spotTerrainFromOwner,
  tiltOf,
  validElevationM,
  type OwnerSlope,
  type TerrainGrid
} from './terrain';
import { planeGrid as planeGridOver } from './testSupport';
import type { LonLat } from './types';

const CENTER: LonLat = [-77.7, 39.08];
const BOX = boxAround(CENTER, 60);
const frame = localFrame(boxCenter(BOX));
const DEG = Math.PI / 180;

const planeGrid = (
  slopePct: number,
  aspectDeg: number,
  opts: { base?: number; resolutionM?: number | null } = {}
): TerrainGrid => planeGridOver(BOX, slopePct, aspectDeg, opts);

const angleDelta = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const spot = rectOf([3, -4], 6.1, 9.1);
const aspectArb = fc.double({ min: 0, max: 359.99, noNaN: true });
const centreArb = fc.tuple(
  fc.double({ min: -20, max: 20, noNaN: true }),
  fc.double({ min: -20, max: 20, noNaN: true })
);

describe('fitPlane', () => {
  it('recovers the gradients of an exact plane', () => {
    const pts: Array<[number, number, number]> = [];
    for (let x = 0; x < 4; x++)
      for (let y = 0; y < 3; y++) pts.push([x, y, 0.1 * x - 0.25 * y + 7]);
    const plane = fitPlane(pts)!;
    expect(plane.dzdx).toBeCloseTo(0.1, 9);
    expect(plane.dzdy).toBeCloseTo(-0.25, 9);
  });

  it('is unknown with too few points, points in a line or values that are not numbers', () => {
    expect(fitPlane([])).toBeNull();
    expect(
      fitPlane([
        [0, 0, 1],
        [1, 0, 1],
        [0, 1, 1]
      ])
    ).toBeNull();
    expect(
      fitPlane([
        [0, 0, 1],
        [1, 1, 2],
        [2, 2, 3],
        [3, 3, 4],
        [4, 4, 5]
      ])
    ).toBeNull();
    expect(
      fitPlane([
        [0, 0, Number.NaN],
        [1, 0, 1],
        [0, 1, 1],
        [1, 1, Number.POSITIVE_INFINITY]
      ])
    ).toBeNull();
  });
});

describe('slope and facing direction from the elevation grid', () => {
  it('recovers a plane of any slope up to 40% and any facing direction', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 40, noNaN: true }),
        aspectArb,
        centreArb,
        (slopePct, aspectDeg, c) => {
          const got = spotTerrainFromGrid(
            planeGrid(slopePct, aspectDeg),
            frame,
            rectOf(c, 6.1, 9.1)
          )!;
          expect(got).not.toBeNull();
          expect(got.slopePct).toBeCloseTo(slopePct, 4);
          expect(got.slopeDeg).toBeCloseTo(Math.atan(slopePct / 100) / DEG, 4);
          if (slopePct >= FLAT_SLOPE_PCT + 0.01) {
            expect(angleDelta(got.aspectDeg!, aspectDeg)).toBeLessThan(0.05);
          }
          if (slopePct < FLAT_SLOPE_PCT - 0.01) expect(got.aspectDeg).toBeNull();
          expect(got.provenance).toBe('data');
        }
      ),
      { numRuns: 200 }
    );
  });

  it('turning the plane turns the facing direction by the same angle', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 3, max: 40, noNaN: true }),
        aspectArb,
        fc.double({ min: 0, max: 360, noNaN: true }),
        (slopePct, aspectDeg, turn) => {
          const a = spotTerrainFromGrid(planeGrid(slopePct, aspectDeg), frame, spot)!;
          const b = spotTerrainFromGrid(planeGrid(slopePct, aspectDeg + turn), frame, spot)!;
          expect(angleDelta(b.aspectDeg!, a.aspectDeg! + turn)).toBeLessThan(0.05);
          expect(b.slopePct).toBeCloseTo(a.slopePct, 4);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('adding the same height to every point changes nothing', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 40, noNaN: true }),
        aspectArb,
        fc.double({ min: -300, max: 3000, noNaN: true }),
        (slopePct, aspectDeg, lift) => {
          const a = spotTerrainFromGrid(
            planeGrid(slopePct, aspectDeg, { base: 100 }),
            frame,
            spot
          )!;
          const b = spotTerrainFromGrid(
            planeGrid(slopePct, aspectDeg, { base: 100 + lift }),
            frame,
            spot
          )!;
          expect(b.slopePct).toBeCloseTo(a.slopePct, 5);
          if (a.aspectDeg === null) expect(b.aspectDeg).toBeNull();
          else expect(angleDelta(a.aspectDeg, b.aspectDeg!)).toBeLessThan(0.01);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('unknown points never crash and never invent a slope from too little', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), {
          minLength: TERRAIN_GRID_N * TERRAIN_GRID_N,
          maxLength: TERRAIN_GRID_N * TERRAIN_GRID_N
        }),
        centreArb,
        (known, c) => {
          const grid = planeGrid(10, 135);
          grid.elevM = grid.elevM.map((z, i) => (known[i] ? z : null));
          const got = spotTerrainFromGrid(grid, frame, rectOf(c, 6.1, 9.1));
          if (got) {
            expect(Number.isFinite(got.slopePct)).toBe(true);
            expect(got.slopePct).toBeCloseTo(10, 4);
            expect(angleDelta(got.aspectDeg!, 135)).toBeLessThan(0.05);
          }
        }
      ),
      { numRuns: 150 }
    );
    const empty = planeGrid(10, 135);
    empty.elevM = empty.elevM.map(() => null);
    expect(spotTerrainFromGrid(empty, frame, spot)).toBeNull();
    const junk = planeGrid(10, 135);
    junk.elevM = junk.elevM.map(() => Number.NaN);
    expect(spotTerrainFromGrid(junk, frame, spot)).toBeNull();
    const short = { ...planeGrid(10, 135), elevM: [1, 2, 3] };
    expect(spotTerrainFromGrid(short, frame, spot)).toBeNull();
  });

  it('uses only the grid points on the spot and one step around it', () => {
    // A hill that is level in the west half and steep in the east half.
    const grid = planeGrid(0, 0);
    const pts = gridPoints(grid.box, grid.n);
    grid.elevM = pts.map((p) => {
      const [x] = toLocal(frame, p);
      return 100 + (x > 0 ? 0.3 * x : 0);
    });
    const west = spotTerrainFromGrid(grid, frame, rectOf([-20, 0], 6, 6))!;
    const east = spotTerrainFromGrid(grid, frame, rectOf([20, 0], 6, 6))!;
    expect(west.slopePct).toBeCloseTo(0, 6);
    expect(west.aspectDeg).toBeNull();
    expect(east.slopePct).toBeCloseTo(30, 4);
    // The ground rises to the east, so it faces west.
    expect(angleDelta(east.aspectDeg!, 270)).toBeLessThan(0.05);
  });

  it('says when the elevation data is coarser than the spot', () => {
    const small = rectOf([0, 0], 1.2, 2.4);
    expect(spotTerrainFromGrid(planeGrid(8, 90, { resolutionM: 1 }), frame, small)!.coarse).toBe(
      false
    );
    const coarse = spotTerrainFromGrid(planeGrid(8, 90, { resolutionM: 10 }), frame, small)!;
    expect(coarse.coarse).toBe(true);
    expect(coarse.resolutionM).toBe(10);
    expect(coarse.slopePct).toBeCloseTo(8, 4);
    expect(spotTerrainFromGrid(planeGrid(8, 90, { resolutionM: null }), frame, small)!.coarse).toBe(
      false
    );
  });

  it('names the level threshold', () => {
    expect(slopeOfPlane(0, 0)).toMatchObject({ slopePct: 0, aspectDeg: null });
    expect(slopeOfPlane(0, (FLAT_SLOPE_PCT - 0.1) / 100).aspectDeg).toBeNull();
    // Rising to the north means facing south.
    expect(slopeOfPlane(0, (FLAT_SLOPE_PCT + 0.1) / 100).aspectDeg).toBeCloseTo(180, 6);
    expect(slopeOfPlane(0.1, 0).aspectDeg).toBeCloseTo(270, 6);
    expect(slopeOfPlane(-0.1, 0).aspectDeg).toBeCloseTo(90, 6);
    expect(slopeOfPlane(0, -0.1).aspectDeg).toBeCloseTo(0, 6);
  });
});

describe('owner-entered slope', () => {
  const ring = (c: XY, half: number): LonLat[] =>
    (
      [
        [c[0] - half, c[1] - half],
        [c[0] + half, c[1] - half],
        [c[0] + half, c[1] + half],
        [c[0] - half, c[1] + half]
      ] as XY[]
    ).map((p) => toLonLat(frame, p));
  const block = (
    id: string,
    c: XY,
    half: number,
    slopePct: number,
    aspectDeg: number
  ): OwnerSlope => ({
    id,
    ring: ring(c, half),
    slopePct,
    aspectDeg
  });

  it('wins over the elevation grid for a spot wholly inside the block, tagged manual', () => {
    const input = { grid: planeGrid(20, 0), ownerSlopes: [block('b1', [0, 0], 15, 6, 180)] };
    const inside = spotTerrain(input, frame, rectOf([2, 2], 6, 9))!;
    expect(inside).toMatchObject({
      slopePct: 6,
      aspectDeg: 180,
      provenance: 'manual',
      coarse: false
    });
    expect(inside.slopeDeg).toBeCloseTo(Math.atan(0.06) / DEG, 9);
    const straddling = spotTerrain(input, frame, rectOf([14, 0], 6, 9))!;
    expect(straddling.provenance).toBe('data');
    expect(straddling.slopePct).toBeCloseTo(20, 4);
  });

  it('a level block has no facing direction, and the first block by id wins', () => {
    expect(
      spotTerrainFromOwner([block('b', [0, 0], 15, 1, 90)], frame, rectOf([0, 0], 4, 4))
    ).toMatchObject({ slopePct: 1, aspectDeg: null, provenance: 'manual' });
    const two = [block('z', [0, 0], 15, 9, 90), block('a', [0, 0], 15, 4, 270)];
    expect(spotTerrainFromOwner(two, frame, rectOf([0, 0], 4, 4))).toMatchObject({ slopePct: 4 });
    expect(spotTerrainFromOwner(two.reverse(), frame, rectOf([0, 0], 4, 4))).toMatchObject({
      slopePct: 4
    });
  });

  it('is nothing without a grid or a block, and bad values are ignored', () => {
    expect(spotTerrain(null, frame, spot)).toBeNull();
    expect(spotTerrain({ grid: null, ownerSlopes: [] }, frame, spot)).toBeNull();
    expect(spotTerrainFromOwner([block('b', [0, 0], 30, Number.NaN, 90)], frame, spot)).toBeNull();
    expect(spotTerrainFromOwner([block('b', [0, 0], 30, -3, 90)], frame, spot)).toBeNull();
  });
});

describe('helpers', () => {
  it('compass words for bearings', () => {
    expect([0, 44, 90, 135, 180, 225, 270, 315, 359, 360, -45].map(compassOf)).toEqual([
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
      'nw',
      'n',
      'n',
      'nw'
    ]);
  });

  it('level or unknown ground has no tilt', () => {
    expect(tiltOf(null)).toBeNull();
    const level = spotTerrainFromGrid(planeGrid(1, 90), frame, spot);
    expect(tiltOf(level)).toBeNull();
    const sloped = spotTerrainFromGrid(planeGrid(10, 90), frame, spot)!;
    expect(tiltOf(sloped)!.aspectDeg).toBeCloseTo(90, 2);
    expect(tiltOf(sloped)!.slopeDeg).toBeCloseTo(Math.atan(0.1) / DEG, 4);
  });

  it('only plausible ground elevations count', () => {
    expect(validElevationM(117.24)).toBe(117.24);
    expect(validElevationM(0)).toBe(0);
    for (const v of [Number.NaN, Infinity, -3.4e38, -9999, 99999, '117', null, undefined]) {
      expect(validElevationM(v)).toBeNull();
    }
  });
});
