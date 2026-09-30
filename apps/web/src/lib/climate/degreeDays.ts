/**
 * Degree days from daily maximum and minimum temperatures (°F).
 *
 * Two methods, both as UC IPM defines them:
 * - `simple-average`: max(0, (Tmax + Tmin) / 2 - base), with Tmax capped at
 *   the upper cutoff when one is set. Tmin is never raised to the base.
 * - `single-sine`: the area under a sine curve through the day's minimum and
 *   maximum, above the base and below a horizontal upper cutoff.
 *
 * Gaps are never filled. A total over days with gaps is a lower bound, which
 * is honest because every day's value is at least zero. Client-safe and pure.
 */

import type { DEGREE_DAY_METHODS } from '$lib/plugins/schemas';

export type DegreeDayMethod = (typeof DEGREE_DAY_METHODS)[number];

export interface DailyTemps {
  /** Calendar day, YYYY-MM-DD. */
  ymd: string;
  tmaxF: number | null;
  tminF: number | null;
}

export interface Accumulation {
  /** Sum over the days that have data, from the start day through `throughYmd`. */
  totalLowerBound: number;
  /** Days between the start and `throughYmd` with no usable max or min. */
  missingDays: number;
  /** The last day with data, or null when none has been published yet. */
  throughYmd: string | null;
}

export interface AccumulateOptions {
  method: DegreeDayMethod;
  baseF: number;
  upperCutoffF?: number;
  /** Last day to count, inclusive (usually yesterday). Later rows are ignored. */
  toYmd: string;
}

function simpleAverage(tmax: number, tmin: number, base: number, upper?: number): number {
  const hi = upper === undefined ? tmax : Math.min(tmax, upper);
  return Math.max(0, (hi + tmin) / 2 - base);
}

function singleSine(tmax: number, tmin: number, base: number, upper?: number): number {
  if (upper !== undefined && tmin >= upper) return upper - base;
  if (tmax <= base) return 0;
  const mean = (tmax + tmin) / 2;
  const amp = (tmax - tmin) / 2;
  const capped = upper !== undefined && tmax > upper;
  if (tmin >= base && !capped) return mean - base;
  if (amp === 0) return Math.max(0, mean - base);
  const halfPi = Math.PI / 2;
  const theta1 = tmin >= base ? -halfPi : Math.asin((base - mean) / amp);
  if (!capped) {
    return ((mean - base) * (halfPi - theta1) + amp * Math.cos(theta1)) / Math.PI;
  }
  const theta2 = Math.asin(((upper as number) - mean) / amp);
  return (
    ((mean - base) * (theta2 - theta1) +
      amp * (Math.cos(theta1) - Math.cos(theta2)) +
      ((upper as number) - base) * (halfPi - theta2)) /
    Math.PI
  );
}

/** One day's degree days. Throws on non-finite input; callers skip gaps first. */
export function dailyDegreeDays(
  tmaxF: number,
  tminF: number,
  method: DegreeDayMethod,
  baseF: number,
  upperCutoffF?: number
): number {
  if (![tmaxF, tminF, baseF].every(Number.isFinite)) {
    throw new RangeError('degree days need finite temperatures');
  }
  if (upperCutoffF !== undefined && !(Number.isFinite(upperCutoffF) && upperCutoffF > baseF)) {
    throw new RangeError('the upper cutoff must be above the base');
  }
  const hi = Math.max(tmaxF, tminF);
  const lo = Math.min(tmaxF, tminF);
  const dd =
    method === 'simple-average'
      ? simpleAverage(hi, lo, baseF, upperCutoffF)
      : singleSine(hi, lo, baseF, upperCutoffF);
  return Math.max(0, dd);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(s: string): boolean {
  if (!YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The day after a YYYY-MM-DD, in the calendar (no time zone involved). */
export function nextYmd(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function usable(d: DailyTemps | undefined): d is DailyTemps & { tmaxF: number; tminF: number } {
  return (
    !!d &&
    typeof d.tmaxF === 'number' &&
    typeof d.tminF === 'number' &&
    Number.isFinite(d.tmaxF) &&
    Number.isFinite(d.tminF)
  );
}

/**
 * Accumulates from `fromYmd` (the biofix, inclusive) through the last day with
 * data on or before `toYmd`. Days not yet published after that last day are
 * not counted as missing; the total reads "through <date>" instead.
 */
export function accumulate(
  days: ReadonlyArray<DailyTemps>,
  fromYmd: string,
  opts: AccumulateOptions
): Accumulation {
  if (!isYmd(fromYmd) || !isYmd(opts.toYmd) || fromYmd > opts.toYmd) {
    return { totalLowerBound: 0, missingDays: 0, throughYmd: null };
  }
  const byDay = new Map<string, DailyTemps>();
  for (const d of days) {
    if (d.ymd >= fromYmd && d.ymd <= opts.toYmd && usable(d)) byDay.set(d.ymd, d);
  }
  let throughYmd: string | null = null;
  for (const ymd of byDay.keys()) if (throughYmd === null || ymd > throughYmd) throughYmd = ymd;
  if (throughYmd === null) return { totalLowerBound: 0, missingDays: 0, throughYmd: null };

  let total = 0;
  let missing = 0;
  for (let ymd = fromYmd; ymd <= throughYmd; ymd = nextYmd(ymd)) {
    const d = byDay.get(ymd);
    if (!usable(d)) {
      missing++;
      continue;
    }
    total += dailyDegreeDays(d.tmaxF, d.tminF, opts.method, opts.baseF, opts.upperCutoffF);
  }
  return { totalLowerBound: total, missingDays: missing, throughYmd };
}
