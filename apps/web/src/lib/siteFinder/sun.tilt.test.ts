import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { localFrame, toLonLat, type XY } from './geometry';
import { MIN_SURFACE_SUN_DEG, estimateSun, shadeCasters, sunDays, type GroundTilt } from './sun';
import { FALLBACK_SEASON, type LonLat, type Obstacle } from './types';

const DEG = Math.PI / 180;
const tilt = (slopePct: number, aspectDeg: number): GroundTilt => ({
  slopeDeg: Math.atan(slopePct / 100) / DEG,
  aspectDeg
});

function world(lat: number) {
  const center: LonLat = [-77.7, lat];
  const frame = localFrame(center);
  const days = sunDays(lat, center[0], FALLBACK_SEASON);
  const tree = (o: { at: XY; radius: number; height: number }, i: number): Obstacle => ({
    id: `t${i}`,
    kind: 'tree',
    shape: { type: 'circle', center: toLonLat(frame, o.at), radiusM: o.radius },
    heightFt: o.height,
    provenance: 'manual'
  });
  return {
    sun: (
      p: XY,
      obstacles: Array<{ at: XY; radius: number; height: number }>,
      t?: GroundTilt | null
    ) => estimateSun(p, days, shadeCasters(frame, obstacles.map(tree)), t)
  };
}

// A northern mid-latitude, where the properties below are meant to hold.
const latArb = fc.double({ min: 30, max: 47, noNaN: true });
const slopeArb = fc.double({ min: 0, max: 40, noNaN: true });
const pos = fc.tuple(
  fc.double({ min: -40, max: 40, noNaN: true }),
  fc.double({ min: -40, max: 40, noNaN: true })
);
const obstaclesArb = fc.array(
  fc.record({
    at: pos,
    radius: fc.double({ min: 1, max: 10, noNaN: true }),
    height: fc.double({ min: 5, max: 90, noNaN: true })
  }),
  { maxLength: 4 }
);

describe('sun on sloping ground', () => {
  it('level or unknown ground is exactly the level-ground estimate', () => {
    fc.assert(
      fc.property(
        latArb,
        pos,
        obstaclesArb,
        fc.double({ min: 0, max: 360, noNaN: true }),
        (lat, p, obstacles, aspect) => {
          const w = world(lat);
          const level = w.sun(p, obstacles);
          expect(w.sun(p, obstacles, null)).toEqual(level);
          expect(w.sun(p, obstacles, undefined)).toEqual(level);
          expect(w.sun(p, obstacles, { slopeDeg: 0, aspectDeg: aspect })).toEqual(level);
          expect(w.sun(p, obstacles, { slopeDeg: Number.NaN, aspectDeg: aspect })).toEqual(level);
          expect('relativeStrength' in level).toBe(false);
        }
      ),
      { numRuns: 40 }
    );
  });

  it('a south-facing slope never has fewer spring and fall hours than level ground, a north-facing one never more', () => {
    fc.assert(
      fc.property(latArb, slopeArb, pos, obstaclesArb, (lat, slopePct, p, obstacles) => {
        const w = world(lat);
        const level = w.sun(p, obstacles);
        const south = w.sun(p, obstacles, tilt(slopePct, 180));
        const north = w.sun(p, obstacles, tilt(slopePct, 0));
        expect(south.hoursSpringFall).toBeGreaterThanOrEqual(level.hoursSpringFall);
        expect(north.hoursSpringFall).toBeLessThanOrEqual(level.hoursSpringFall);
        expect(north.hoursSummer).toBeLessThanOrEqual(level.hoursSummer);
        if (south.relativeStrength !== undefined) {
          expect(south.relativeStrength).toBeGreaterThanOrEqual(1);
          expect(north.relativeStrength!).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 80 }
    );
  });

  it('a slope never adds hours, whichever way it faces', () => {
    fc.assert(
      fc.property(
        latArb,
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 360, noNaN: true }),
        pos,
        obstaclesArb,
        (lat, slopePct, aspect, p, obstacles) => {
          const w = world(lat);
          const level = w.sun(p, obstacles);
          const sloped = w.sun(p, obstacles, tilt(slopePct, aspect));
          expect(sloped.hoursSummer).toBeLessThanOrEqual(level.hoursSummer);
          expect(sloped.hoursSpringFall).toBeLessThanOrEqual(level.hoursSpringFall);
        }
      ),
      { numRuns: 80 }
    );
  });

  it('a steeper north-facing slope never has more hours or stronger sun', () => {
    fc.assert(
      fc.property(
        latArb,
        fc.double({ min: 0.1, max: 100, noNaN: true }),
        fc.double({ min: 0.1, max: 100, noNaN: true }),
        pos,
        obstaclesArb,
        (lat, a, b, p, obstacles) => {
          const w = world(lat);
          const gentle = w.sun(p, obstacles, tilt(Math.min(a, b), 0));
          const steep = w.sun(p, obstacles, tilt(Math.max(a, b), 0));
          expect(steep.hoursSummer).toBeLessThanOrEqual(gentle.hoursSummer);
          expect(steep.hoursSpringFall).toBeLessThanOrEqual(gentle.hoursSpringFall);
          expect(steep.relativeStrength!).toBeLessThanOrEqual(gentle.relativeStrength! + 0.011);
        }
      ),
      { numRuns: 80 }
    );
  });

  it('an east-facing slope leans the day toward morning and a west-facing one toward afternoon', () => {
    fc.assert(
      fc.property(latArb, fc.double({ min: 2, max: 100, noNaN: true }), (lat, slopePct) => {
        const w = world(lat);
        expect(w.sun([0, 0], [], tilt(slopePct, 90)).morningVsAfternoon).not.toBe('afternoon');
        expect(w.sun([0, 0], [], tilt(slopePct, 270)).morningVsAfternoon).not.toBe('morning');
      }),
      { numRuns: 60 }
    );
    const w = world(39.08);
    expect(w.sun([0, 0], [], tilt(45, 90)).morningVsAfternoon).toBe('morning');
    expect(w.sun([0, 0], [], tilt(45, 270)).morningVsAfternoon).toBe('afternoon');
    expect(w.sun([0, 0], [], tilt(45, 180)).morningVsAfternoon).toBe('even');
  });

  it('gives finite numbers for any slope up to 100% and any facing direction', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.double({ min: -720, max: 720, noNaN: true }),
        pos,
        obstaclesArb,
        (lat, slopePct, aspect, p, obstacles) => {
          const e = world(lat).sun(p, obstacles, tilt(slopePct, aspect));
          for (const v of [e.hoursSummer, e.hoursSpringFall, e.shadedHoursSummer]) {
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
          }
          if (e.relativeStrength !== undefined) {
            expect(Number.isFinite(e.relativeStrength)).toBe(true);
            expect(e.relativeStrength).toBeGreaterThanOrEqual(0);
          }
        }
      ),
      { numRuns: 80 }
    );
  });

  it('at Loudoun a moderate north slope keeps its hours and loses strength; a south slope gains it', () => {
    const w = world(39.08);
    const level = w.sun([0, 0], []);
    const north = w.sun([0, 0], [], tilt(12, 0));
    const south = w.sun([0, 0], [], tilt(12, 180));
    expect(north.hoursSummer).toBe(level.hoursSummer);
    expect(north.hoursSpringFall).toBe(level.hoursSpringFall);
    expect(north.relativeStrength).toBeCloseTo(0.9, 2);
    expect(south.relativeStrength).toBeCloseTo(1.08, 2);
    // A very steep north slope is in its own shadow around midday in fall.
    expect(w.sun([0, 0], [], tilt(100, 0)).hoursSpringFall).toBeLessThan(level.hoursSpringFall - 3);
    expect(MIN_SURFACE_SUN_DEG).toBeGreaterThan(0);
    expect(MIN_SURFACE_SUN_DEG).toBeLessThan(10);
  });
});
