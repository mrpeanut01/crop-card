/**
 * Bed occupancy over time, for the time scrubber. The interval rule is the
 * one `scheduleCandidacy` uses, so the designer and the allocation wizard
 * agree: see docs/design/GARDEN_DESIGNER.md ("Occupancy").
 */

import { ARCHETYPES, resolveArchetype, type Archetype } from '$lib/plugins/schemas';
import { frostSeasonShape, monthDayOfYear } from '$lib/schedule/frostSeason';
import type {
  BedLayout,
  Footprint,
  BedOccupancyOnDate,
  GardenCrop,
  OccupancyInterval,
  PlacedPlanting,
  ScrubRange
} from './types';

export const BED_TURNOVER_DAYS = 10;
export const FALLBACK_DTM_DAYS = 90;

/** Days a harvest runs past `daysToMaturity.max`. `until-frost` ends it at the
 *  first fall frost and `season` holds the bed from planting to that frost. */
export type HarvestTail = number | 'until-frost' | 'season';

export const ARCHETYPE_HARVEST_TAIL: Record<Archetype, HarvestTail> = {
  'small-grain.zadoks': 0,
  'row-grain.pollination': 0,
  'dry-seed-legume': 0,
  'winter-squash-cure': 0,
  'continuous-harvest-fruit': 'until-frost',
  'cut-and-come-again-leafy': 21,
  'cover-crop.termination': 0,
  'forage-cutting-cycle': 'season',
  'perennial-vine-quality': 'season',
  'tree-fruit-multi-pick': 'season'
};

export interface OccupancyOptions {
  firstFallFrostMs: number;
  /** The same season's last spring frost; tells a year-crossing season apart. */
  lastSpringFrostMs?: number;
}

export type OccupancyPlanting = Pick<
  PlacedPlanting,
  | 'cropId'
  | 'blockId'
  | 'cropPluginId'
  | 'status'
  | 'plantingDateMs'
  | 'harvestedAtMs'
  | 'footprint'
>;

export const ONE_DAY_MS = 86_400_000;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jul 1" for a UTC day. */
export function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function utcDayStart(ms: number): number {
  return Math.floor(ms / ONE_DAY_MS) * ONE_DAY_MS;
}

/** The UTC day a date-only value means. Planting dates are written at
 *  midnight in whatever zone the writer was in (the swim-lane uses the
 *  browser's local midnight, the designer UTC midnight), so the nearest
 *  UTC midnight is the day that was picked. */
export function plantingDay(ms: number): number {
  return Math.round(ms / ONE_DAY_MS) * ONE_DAY_MS;
}

/** The first fall frost that ends the season `ms` falls in. For an ordinary
 *  season that is the frost date in the calendar year of `ms`, so a frost
 *  date for one season can bound plantings in another. When the season
 *  crosses the new year, a date on or after the spring frost's month and day
 *  belongs to the season whose fall frost comes the next calendar year.
 *  Without the spring frost, a fall frost in January to June can only mean
 *  such a season, and the next one on or after `ms` is used. */
export function frostInYearOf(
  firstFallFrostMs: number,
  ms: number,
  lastSpringFrostMs?: number
): number {
  const frost = new Date(firstFallFrostMs);
  const at = (year: number) =>
    Date.UTC(
      year,
      frost.getUTCMonth(),
      frost.getUTCDate(),
      frost.getUTCHours(),
      frost.getUTCMinutes(),
      frost.getUTCSeconds(),
      frost.getUTCMilliseconds()
    );
  const when = new Date(ms);
  const year = when.getUTCFullYear();
  const fallMd = { month: frost.getUTCMonth(), day: frost.getUTCDate() };
  if (lastSpringFrostMs === undefined || !Number.isFinite(lastSpringFrostMs)) {
    if (fallMd.month >= 6) return at(year);
    return ms <= at(year) ? at(year) : at(year + 1);
  }
  const spring = new Date(lastSpringFrostMs);
  const springMd = { month: spring.getUTCMonth(), day: spring.getUTCDate() };
  if (frostSeasonShape(springMd, fallMd) === 'same-year') return at(year);
  const msDay = monthDayOfYear({ month: when.getUTCMonth(), day: when.getUTCDate() });
  return msDay >= monthDayOfYear(springMd) ? at(year + 1) : at(year);
}

function positiveDays(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Days to first harvest and to the end of maturity, from the plugin's
 *  `daysToMaturity`, else `FALLBACK_DTM_DAYS`. */
export function maturityDays(crop: GardenCrop | undefined): { min: number; max: number } {
  const lo = positiveDays(crop?.daysToMaturity?.min);
  const hi = positiveDays(crop?.daysToMaturity?.max);
  const max = hi ?? lo ?? FALLBACK_DTM_DAYS;
  const min = Math.min(lo ?? hi ?? FALLBACK_DTM_DAYS, max);
  return { min, max };
}

export function harvestTailFor(crop: GardenCrop | undefined): HarvestTail {
  if (!crop) return 0;
  const explicit =
    crop?.archetype && (ARCHETYPES as readonly string[]).includes(crop.archetype)
      ? (crop.archetype as Archetype)
      : undefined;
  return ARCHETYPE_HARVEST_TAIL[
    resolveArchetype({ archetype: explicit, cropFamily: crop.cropFamily })
  ];
}

/** Null for unscheduled, failed or archived plantings. A recorded harvest
 *  date replaces the estimated harvest end and sets `actual`. */
export function plantingOccupancy(
  planting: OccupancyPlanting,
  crop: GardenCrop | undefined,
  opts: OccupancyOptions
): OccupancyInterval | null {
  if (planting.status === 'failed' || planting.status === 'archived') return null;
  const rawStart = planting.plantingDateMs;
  if (rawStart == null || !Number.isFinite(rawStart)) return null;
  const startMs = plantingDay(rawStart);
  const dtm = maturityDays(crop);
  const maturityEnd = startMs + dtm.max * ONE_DAY_MS;
  let harvestStartMs = startMs + dtm.min * ONE_DAY_MS;
  let harvestEndMs: number;
  const tail = harvestTailFor(crop);
  if (typeof tail === 'number') {
    harvestEndMs = maturityEnd + tail * ONE_DAY_MS;
  } else {
    harvestEndMs = Math.max(
      maturityEnd,
      frostInYearOf(opts.firstFallFrostMs, harvestStartMs, opts.lastSpringFrostMs)
    );
  }
  let actual = false;
  const harvested = planting.harvestedAtMs;
  if (harvested != null && Number.isFinite(harvested)) {
    harvestEndMs = Math.max(startMs, utcDayStart(harvested));
    harvestStartMs = Math.min(harvestStartMs, harvestEndMs);
    actual = true;
  }
  return {
    cropId: planting.cropId,
    blockId: planting.blockId,
    startMs,
    harvestStartMs,
    harvestEndMs,
    endMs: harvestEndMs + BED_TURNOVER_DAYS * ONE_DAY_MS,
    footprint: planting.footprint,
    actual
  };
}

/** Intervals for every scheduled planting, sorted by bed, then start. */
export function occupancyIntervals(
  plantings: readonly OccupancyPlanting[],
  crops: Readonly<Record<string, GardenCrop>>,
  opts: OccupancyOptions
): OccupancyInterval[] {
  const out: OccupancyInterval[] = [];
  for (const p of plantings) {
    const iv = plantingOccupancy(p, crops[p.cropPluginId], opts);
    if (iv) out.push(iv);
  }
  return out.sort(
    (a, b) =>
      (a.blockId < b.blockId ? -1 : a.blockId > b.blockId ? 1 : 0) ||
      a.startMs - b.startMs ||
      (a.cropId < b.cropId ? -1 : a.cropId > b.cropId ? 1 : 0)
  );
}

export function intervalsOverlapInTime(
  a: Pick<OccupancyInterval, 'startMs' | 'endMs'>,
  b: Pick<OccupancyInterval, 'startMs' | 'endMs'>
): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

function coveredSqIn(
  bedW: number,
  bedL: number,
  footprints: ReadonlyArray<Footprint | null>
): number {
  if (footprints.some((f) => f === null)) return bedW * bedL;
  const rects = (footprints as Footprint[])
    .map((f) => ({
      x0: Math.max(0, f.x_in),
      y0: Math.max(0, f.y_in),
      x1: Math.min(bedW, f.x_in + f.w_in),
      y1: Math.min(bedL, f.y_in + f.l_in)
    }))
    .filter((r) => r.x1 > r.x0 && r.y1 > r.y0);
  if (rects.length === 0) return 0;
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const xa = xs[i];
    const xb = xs[i + 1];
    const spans = rects
      .filter((r) => r.x0 <= xa && r.x1 >= xb)
      .map((r) => [r.y0, r.y1] as const)
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let curStart = -Infinity;
    let curEnd = -Infinity;
    for (const [s, e] of spans) {
      if (s > curEnd) {
        if (curEnd > curStart) covered += curEnd - curStart;
        curStart = s;
        curEnd = e;
      } else if (e > curEnd) curEnd = e;
    }
    if (curEnd > curStart) covered += curEnd - curStart;
    area += covered * (xb - xa);
  }
  return area;
}

/** Share of the bed's area not covered by `footprints`, 0 to 1. A null
 *  footprint covers the whole bed. */
export function freeFractionOf(
  bed: Pick<BedLayout, 'widthFt' | 'lengthFt'>,
  footprints: ReadonlyArray<Footprint | null>
): number {
  const bedW = bed.widthFt * 12;
  const bedL = bed.lengthFt * 12;
  const total = bedW * bedL;
  if (!(total > 0)) return footprints.length ? 0 : 1;
  const free = 1 - coveredSqIn(bedW, bedL, footprints) / total;
  return Math.min(1, Math.max(0, free));
}

/** A day is occupied when `startMs <= day < endMs`. */
export function bedOccupancyOn(
  bed: Pick<BedLayout, 'blockId' | 'widthFt' | 'lengthFt'>,
  intervals: readonly OccupancyInterval[],
  dateMs: number,
  range: ScrubRange
): BedOccupancyOnDate {
  const mine = intervals.filter((i) => i.blockId === bed.blockId);
  const covers = (i: OccupancyInterval, t: number) => i.startMs <= t && t < i.endMs;
  const occupants = mine.filter((i) => covers(i, dateMs)).sort((a, b) => a.startMs - b.startMs);
  let openSinceMs: number | null = null;
  let nextOpenMs: number | null = null;
  if (occupants.length === 0) {
    for (const i of mine) {
      if (i.endMs <= dateMs && i.endMs > range.startMs && i.startMs < dateMs) {
        openSinceMs = openSinceMs === null ? i.endMs : Math.max(openSinceMs, i.endMs);
      }
    }
  } else {
    let cursor = dateMs;
    for (;;) {
      const holding = mine.filter((i) => covers(i, cursor));
      if (holding.length === 0) break;
      cursor = Math.max(...holding.map((i) => i.endMs));
    }
    nextOpenMs = cursor >= range.endMs ? null : cursor;
  }
  return {
    blockId: bed.blockId,
    dateMs,
    occupants,
    freeFraction: freeFractionOf(
      bed,
      occupants.map((o) => o.footprint)
    ),
    openSinceMs,
    nextOpenMs
  };
}

/** Jan 1 of `seasonYear` to Dec 31, widened to cover every interval that
 *  touches the year and a season's frost dates that fall outside it. `todayMs` is `nowMs`'s UTC day, clamped into the range. */
export function scrubRange(
  seasonYear: number,
  intervals: readonly OccupancyInterval[],
  nowMs: number,
  frost?: { lastSpringFrostMs: number; firstFallFrostMs: number }
): ScrubRange {
  const yearStart = Date.UTC(seasonYear, 0, 1);
  const yearEnd = Date.UTC(seasonYear, 11, 31);
  let startMs = yearStart;
  let endMs = yearEnd;
  if (frost) {
    startMs = Math.min(startMs, utcDayStart(frost.lastSpringFrostMs));
    endMs = Math.max(endMs, utcDayStart(frost.firstFallFrostMs));
  }
  for (const i of intervals) {
    if (i.startMs > yearEnd + ONE_DAY_MS || i.endMs < yearStart) continue;
    startMs = Math.min(startMs, utcDayStart(i.startMs));
    endMs = Math.max(endMs, utcDayStart(i.endMs));
  }
  const todayMs = Math.min(endMs, Math.max(startMs, utcDayStart(nowMs)));
  return { startMs, endMs, todayMs };
}

/** Day starts where the bed changes (a planting goes in or comes out), for
 *  the slider's tick marks and keyboard PageUp/PageDown stops. */
export function occupancyChangeDays(
  intervals: readonly OccupancyInterval[],
  blockId?: string
): number[] {
  const days = new Set<number>();
  for (const i of intervals) {
    if (blockId !== undefined && i.blockId !== blockId) continue;
    days.add(utcDayStart(i.startMs));
    days.add(utcDayStart(i.endMs));
  }
  return [...days].sort((a, b) => a - b);
}
