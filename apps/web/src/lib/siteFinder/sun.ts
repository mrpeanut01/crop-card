/**
 * Estimated hours of direct sun at a point, from the sun's path and the
 * shadows of the obstacles around it. Pure and client-safe. This is a rough
 * guide (P-6): flat ground, simple shapes, one height per obstacle. It is
 * never shown as a measurement or as an extension recommendation.
 */

import { feetToMeters, shadowLengthMeters, solarPosition } from '$lib/calendar/solar';
import {
  segmentShapeDist,
  shapeToLocal,
  type LocalFrame,
  type LocalShape,
  type XY
} from './geometry';
import type { Obstacle, SunEstimate, SunSeason } from './types';

// Every constant below is an app-owned rough guide.
/** Sun lower than this is not counted: it is weak and usually blocked by
 *  things far outside the search box. */
export const MIN_SUN_ELEVATION_DEG = 10;
export const SUN_STEP_HOURS = 0.5;
/** Shadows longer than this are ignored. */
export const MAX_SHADOW_M = 150;
/** Heights used when nobody gave one. The estimate then says "height
 *  guessed". */
export const DEFAULT_TREE_HEIGHT_FT = 40;
export const DEFAULT_BUILDING_HEIGHT_FT = 15;
export const DEFAULT_OTHER_HEIGHT_FT = 8;
/** How much of the sun a leafless deciduous tree still blocks. */
export const BARE_TREE_SHADE_FRACTION = 0.3;
/** Summer hours of direct sun for the plain-word bands. */
export const FULL_SUN_HOURS = 6;
export const PART_SUN_HOURS = 4;
/** One side of the day counts as sunnier when it leads by this many hours. */
export const SIDE_LEAD_HOURS = 1;

const NORTH_SUMMER_DAYS = [141, 172, 202];
const SOUTH_SUMMER_DAYS = [324, 355, 20];
const DEG = Math.PI / 180;

export interface SunSample {
  /** Unit vector toward the sun on the ground (x east, y north). */
  dir: XY;
  elevationDeg: number;
  morning: boolean;
}

function dayMs(dayOfYear: number): number {
  return Date.UTC(2025, 0, Math.max(1, Math.min(365, Math.round(dayOfYear))), 12);
}

/** The sun's positions above the cutoff through one day, at half-hour steps. */
export function sunSamplesForDay(lat: number, lon: number, dayOfYear: number): SunSample[] {
  const out: SunSample[] = [];
  const ms = dayMs(dayOfYear);
  for (let h = 0; h < 24; h += SUN_STEP_HOURS) {
    const pos = solarPosition(lat, lon, ms, h + SUN_STEP_HOURS / 2);
    if (pos.elevationDeg < MIN_SUN_ELEVATION_DEG) continue;
    const az = pos.azimuthDeg * DEG;
    const morning = lat >= 0 ? pos.azimuthDeg < 180 : pos.azimuthDeg > 180;
    out.push({ dir: [Math.sin(az), Math.cos(az)], elevationDeg: pos.elevationDeg, morning });
  }
  return out;
}

export interface SunDays {
  summer: Array<{ day: number; samples: SunSample[] }>;
  ends: Array<{ day: number; samples: SunSample[] }>;
}

/** Sample days for a place and season, computed once per run. */
export function sunDays(lat: number, lon: number, season: SunSeason): SunDays {
  const mk = (day: number) => ({ day, samples: sunSamplesForDay(lat, lon, day) });
  return {
    summer: (lat >= 0 ? NORTH_SUMMER_DAYS : SOUTH_SUMMER_DAYS).map(mk),
    ends: [mk(season.startDay), mk(season.endDay)]
  };
}

export interface ShadeCaster {
  id: string;
  shape: LocalShape;
  heightM: number;
  guessed: boolean;
  deciduous: { leafOnDay: number; leafOffDay: number } | null;
}

export function defaultHeightFt(kind: Obstacle['kind']): number {
  if (kind === 'tree' || kind === 'tree-line') return DEFAULT_TREE_HEIGHT_FT;
  if (kind === 'building') return DEFAULT_BUILDING_HEIGHT_FT;
  return DEFAULT_OTHER_HEIGHT_FT;
}

/** Obstacles that stand up and cast shade. Water and pavement do not. */
export function shadeCasters(frame: LocalFrame, obstacles: readonly Obstacle[]): ShadeCaster[] {
  const out: ShadeCaster[] = [];
  for (const o of obstacles) {
    if (o.kind === 'water' || o.kind === 'pavement') continue;
    const known = typeof o.heightFt === 'number' && Number.isFinite(o.heightFt) && o.heightFt > 0;
    out.push({
      id: o.id,
      shape: shapeToLocal(frame, o.shape),
      heightM: feetToMeters(known ? (o.heightFt as number) : defaultHeightFt(o.kind)),
      guessed: !known,
      deciduous: o.deciduous ?? null
    });
  }
  return out;
}

function inLeaf(d: { leafOnDay: number; leafOffDay: number }, day: number): boolean {
  return d.leafOnDay <= d.leafOffDay
    ? day >= d.leafOnDay && day <= d.leafOffDay
    : day >= d.leafOnDay || day <= d.leafOffDay;
}

/** How much of the sun a caster blocks at a point for one sun position:
 *  0 when its shadow does not reach, else 1 (or less for a bare tree). */
export function shadeFraction(p: XY, s: SunSample, c: ShadeCaster, day: number): number {
  const reach = Math.min(MAX_SHADOW_M, shadowLengthMeters(c.heightM, s.elevationDeg));
  const end: XY = [p[0] + s.dir[0] * reach, p[1] + s.dir[1] * reach];
  if (segmentShapeDist(p, end, c.shape) > 0) return 0;
  return c.deciduous && !inLeaf(c.deciduous, day) ? BARE_TREE_SHADE_FRACTION : 1;
}

interface DayTotal {
  hours: number;
  open: number;
  morning: number;
  afternoon: number;
  lostBy: Map<string, { morning: number; afternoon: number }>;
  guessed: boolean;
}

function dayTotal(
  p: XY,
  day: { day: number; samples: SunSample[] },
  casters: readonly ShadeCaster[]
): DayTotal {
  const t: DayTotal = {
    hours: 0,
    open: 0,
    morning: 0,
    afternoon: 0,
    lostBy: new Map(),
    guessed: false
  };
  for (const s of day.samples) {
    let worst = 0;
    let by: ShadeCaster | null = null;
    for (const c of casters) {
      const f = shadeFraction(p, s, c, day.day);
      if (f > worst) {
        worst = f;
        by = c;
      }
    }
    const lit = SUN_STEP_HOURS * (1 - worst);
    t.open += SUN_STEP_HOURS;
    t.hours += lit;
    if (s.morning) t.morning += lit;
    else t.afternoon += lit;
    if (by) {
      const cur = t.lostBy.get(by.id) ?? { morning: 0, afternoon: 0 };
      if (s.morning) cur.morning += SUN_STEP_HOURS * worst;
      else cur.afternoon += SUN_STEP_HOURS * worst;
      t.lostBy.set(by.id, cur);
      if (by.guessed) t.guessed = true;
    }
  }
  return t;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The sun estimate for one point in the local frame. */
export function estimateSun(p: XY, days: SunDays, casters: readonly ShadeCaster[]): SunEstimate {
  const summer = days.summer.map((d) => dayTotal(p, d, casters));
  const ends = days.ends.map((d) => dayTotal(p, d, casters));
  const avg = (rows: DayTotal[], pick: (t: DayTotal) => number) =>
    rows.length ? rows.reduce((sum, t) => sum + pick(t), 0) / rows.length : 0;

  const hoursSummer = avg(summer, (t) => t.hours);
  const morning = avg(summer, (t) => t.morning);
  const afternoon = avg(summer, (t) => t.afternoon);
  const shaded = avg(summer, (t) => t.open - t.hours);

  const lost = new Map<string, { morning: number; afternoon: number }>();
  for (const t of summer) {
    for (const [id, v] of t.lostBy) {
      const cur = lost.get(id) ?? { morning: 0, afternoon: 0 };
      cur.morning += v.morning / summer.length;
      cur.afternoon += v.afternoon / summer.length;
      lost.set(id, cur);
    }
  }
  let mainShade: SunEstimate['mainShade'] = null;
  let most = 0;
  for (const [id, v] of [...lost].sort((a, b) => a[0].localeCompare(b[0]))) {
    const total = v.morning + v.afternoon;
    if (total > most) {
      most = total;
      mainShade = {
        obstacleId: id,
        when:
          v.morning >= 2 * v.afternoon
            ? 'morning'
            : v.afternoon >= 2 * v.morning
              ? 'afternoon'
              : 'all-day'
      };
    }
  }

  return {
    hoursSummer: round1(hoursSummer),
    hoursSpringFall: round1(avg(ends, (t) => t.hours)),
    morningVsAfternoon:
      morning - afternoon >= SIDE_LEAD_HOURS
        ? 'morning'
        : afternoon - morning >= SIDE_LEAD_HOURS
          ? 'afternoon'
          : 'even',
    shadedHoursSummer: round1(shaded),
    mainShade: most >= SUN_STEP_HOURS ? mainShade : null,
    heightGuessed: [...summer, ...ends].some((t) => t.guessed),
    provenance: 'fallback'
  };
}

export type SunBand = 'full' | 'part' | 'shade';

export function sunBand(hoursSummer: number): SunBand {
  if (hoursSummer >= FULL_SUN_HOURS) return 'full';
  if (hoursSummer >= PART_SUN_HOURS) return 'part';
  return 'shade';
}
