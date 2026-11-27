import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { localFrame, toLonLat, type XY } from './geometry';
import {
  BARE_TREE_SHADE_FRACTION,
  DEFAULT_TREE_HEIGHT_FT,
  FULL_SUN_HOURS,
  MIN_SUN_ELEVATION_DEG,
  PART_SUN_HOURS,
  SUN_STEP_HOURS,
  estimateSun,
  shadeCasters,
  sunBand,
  sunDays,
  sunSamplesForDay
} from './sun';
import { FALLBACK_SEASON, type LonLat, type Obstacle } from './types';

const CENTER: LonLat = [-77.7, 39.08];
const frame = localFrame(CENTER);
const days = sunDays(CENTER[1], CENTER[0], FALLBACK_SEASON);

function tree(id: string, at: XY, radiusM = 4, heightFt: number | null = 40): Obstacle {
  return {
    id,
    kind: 'tree',
    shape: { type: 'circle', center: toLonLat(frame, at), radiusM },
    heightFt,
    provenance: 'manual'
  };
}

const sunAt = (p: XY, obstacles: Obstacle[]) =>
  estimateSun(p, days, shadeCasters(frame, obstacles));

const pos = fc.tuple(
  fc.double({ min: -60, max: 60, noNaN: true }),
  fc.double({ min: -60, max: 60, noNaN: true })
);
const obstacleArb = fc.record({
  at: pos,
  radius: fc.double({ min: 1, max: 10, noNaN: true }),
  height: fc.double({ min: 5, max: 90, noNaN: true })
});

describe('sun samples', () => {
  it('count only the sun above the cutoff and split morning from afternoon', () => {
    const june = sunSamplesForDay(CENTER[1], CENTER[0], 172);
    const dec = sunSamplesForDay(CENTER[1], CENTER[0], 355);
    expect(june.every((s) => s.elevationDeg >= MIN_SUN_ELEVATION_DEG)).toBe(true);
    expect(june.length).toBeGreaterThan(dec.length);
    expect(june.some((s) => s.morning)).toBe(true);
    expect(june.some((s) => !s.morning)).toBe(true);
    // Morning sun is in the east, afternoon sun in the west.
    expect(june.filter((s) => s.morning).every((s) => s.dir[0] > 0)).toBe(true);
    expect(june.filter((s) => !s.morning).every((s) => s.dir[0] < 0)).toBe(true);
  });
});

describe('estimateSun', () => {
  it('with no obstacles gives every counted hour of the day', () => {
    const open = sunAt([0, 0], []);
    const expected =
      days.summer.reduce((sum, d) => sum + d.samples.length * SUN_STEP_HOURS, 0) /
      days.summer.length;
    expect(open.hoursSummer).toBeCloseTo(expected, 1);
    expect(open.shadedHoursSummer).toBe(0);
    expect(open.mainShade).toBeNull();
    expect(open.heightGuessed).toBe(false);
    expect(open.morningVsAfternoon).toBe('even');
    expect(open.hoursSummer).toBeGreaterThan(open.hoursSpringFall);
    expect(open.provenance).toBe('fallback');
  });

  it('adding an obstacle never increases the sun', () => {
    fc.assert(
      fc.property(pos, fc.array(obstacleArb, { maxLength: 5 }), obstacleArb, (p, base, extra) => {
        const mk = (o: (typeof base)[number], i: number) => tree(`t${i}`, o.at, o.radius, o.height);
        const before = sunAt(p, base.map(mk));
        const after = sunAt(p, [...base.map(mk), mk(extra, 99)]);
        expect(after.hoursSummer).toBeLessThanOrEqual(before.hoursSummer + 1e-9);
        expect(after.hoursSpringFall).toBeLessThanOrEqual(before.hoursSpringFall + 1e-9);
      }),
      { numRuns: 60 }
    );
  });

  it('a taller obstacle never increases the sun', () => {
    fc.assert(
      fc.property(pos, obstacleArb, fc.double({ min: 1, max: 60, noNaN: true }), (p, o, more) => {
        const low = sunAt(p, [tree('t', o.at, o.radius, o.height)]);
        const high = sunAt(p, [tree('t', o.at, o.radius, o.height + more)]);
        expect(high.hoursSummer).toBeLessThanOrEqual(low.hoursSummer + 1e-9);
        expect(high.hoursSpringFall).toBeLessThanOrEqual(low.hoursSpringFall + 1e-9);
      }),
      { numRuns: 60 }
    );
  });

  it('the result does not depend on the order of the obstacles', () => {
    const a = tree('a', [12, 0]);
    const b = tree('b', [-12, 3], 5, 60);
    const c = tree('c', [0, -15], 3, 30);
    expect(sunAt([0, 0], [a, b, c])).toEqual(sunAt([0, 0], [c, a, b]));
  });

  it('east and west obstacles mirror each other', () => {
    const east = sunAt([0, 0], [tree('e', [12, 0], 4, 50)]);
    const west = sunAt([0, 0], [tree('w', [-12, 0], 4, 50)]);
    expect(east.mainShade?.when).toBe('morning');
    expect(west.mainShade?.when).toBe('afternoon');
    expect(east.morningVsAfternoon).toBe('afternoon');
    expect(west.morningVsAfternoon).toBe('morning');
    expect(Math.abs(east.hoursSummer - west.hoursSummer)).toBeLessThanOrEqual(1);
  });

  it('at this latitude a wall to the south shades the season ends more than one to the north', () => {
    const wall = (id: string, y: number): Obstacle => ({
      id,
      kind: 'building',
      shape: {
        type: 'polygon',
        ring: (
          [
            [-30, y - 2],
            [30, y - 2],
            [30, y + 2],
            [-30, y + 2]
          ] as XY[]
        ).map((p) => toLonLat(frame, p))
      },
      heightFt: 30,
      provenance: 'manual'
    });
    const south = sunAt([0, 0], [wall('s', -8)]);
    const north = sunAt([0, 0], [wall('n', 8)]);
    expect(south.hoursSpringFall).toBeLessThan(north.hoursSpringFall);
  });

  it('a point under a tree gets no summer sun', () => {
    const under = sunAt([0, 0], [tree('t', [0, 0], 6, 40)]);
    expect(under.hoursSummer).toBe(0);
    expect(under.mainShade).toEqual({ obstacleId: 't', when: 'all-day' });
  });

  it('a leafless deciduous tree blocks only part of the sun', () => {
    const evergreen = tree('t', [0, -6], 5, 50);
    const deciduous: Obstacle = { ...evergreen, deciduous: { leafOnDay: 120, leafOffDay: 280 } };
    const a = sunAt([0, 0], [evergreen]);
    const b = sunAt([0, 0], [deciduous]);
    expect(b.hoursSummer).toBeCloseTo(a.hoursSummer, 5);
    expect(b.hoursSpringFall).toBeGreaterThan(a.hoursSpringFall);
    expect(BARE_TREE_SHADE_FRACTION).toBeGreaterThan(0);
    expect(BARE_TREE_SHADE_FRACTION).toBeLessThan(1);
  });

  it('an unknown height uses the app default and says it was guessed', () => {
    const guessed = sunAt([0, 0], [tree('t', [10, 0], 4, null)]);
    const stated = sunAt([0, 0], [tree('t', [10, 0], 4, DEFAULT_TREE_HEIGHT_FT)]);
    expect(guessed.hoursSummer).toBe(stated.hoursSummer);
    expect(guessed.heightGuessed).toBe(true);
    expect(stated.heightGuessed).toBe(false);
  });

  it('water and pavement cast no shade', () => {
    const pond: Obstacle = { ...tree('p', [0, 0], 8, 30), kind: 'water' };
    expect(sunAt([0, 0], [pond]).shadedHoursSummer).toBe(0);
  });
});

describe('sunBand', () => {
  it('uses the named app thresholds', () => {
    expect(sunBand(FULL_SUN_HOURS)).toBe('full');
    expect(sunBand(FULL_SUN_HOURS - 0.1)).toBe('part');
    expect(sunBand(PART_SUN_HOURS)).toBe('part');
    expect(sunBand(PART_SUN_HOURS - 0.1)).toBe('shade');
  });
});
