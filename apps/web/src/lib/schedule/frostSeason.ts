/**
 * Which calendar year each frost date of a growing season falls in. Most
 * farms have a spring frost and a fall frost in the same year. At some warm
 * stations the frost season is a few midwinter weeks, so the "last spring"
 * date comes in late December or the "first fall" date in early January, and
 * one season spans two calendar years. Client-safe and pure.
 */

import {
  LOUDOUN_DEFAULT_FIRST_FROST_MMDD,
  LOUDOUN_DEFAULT_LAST_FROST_MMDD,
  parseMmDd
} from './constants';

export interface MonthDay {
  /** 0-based month, as `parseMmDd` returns it. */
  month: number;
  day: number;
}

export type FrostSeasonShape = 'same-year' | 'fall-next-year' | 'spring-prior-year';

const CUM_DAYS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const MID_YEAR_DAY = 182;

/** Day of a non-leap year, Jan 1 = 1. Feb 29 counts as Feb 28's neighbour (60). */
export function monthDayOfYear(md: MonthDay): number {
  return CUM_DAYS[md.month] + md.day;
}

/**
 * `same-year` when the last spring frost comes before the first fall frost
 * in calendar order. Otherwise the season crosses the new year: a spring date
 * in the second half of the year belongs to the year before, and otherwise
 * the fall date belongs to the year after.
 */
export function frostSeasonShape(lastSpring: MonthDay, firstFall: MonthDay): FrostSeasonShape {
  const spring = monthDayOfYear(lastSpring);
  const fall = monthDayOfYear(firstFall);
  if (spring < fall) return 'same-year';
  return spring > MID_YEAR_DAY ? 'spring-prior-year' : 'fall-next-year';
}

/** Calendar years of the last spring and first fall frost for season `year`. */
export function frostSeasonYears(
  year: number,
  lastSpring: MonthDay,
  firstFall: MonthDay
): { lastSpringYear: number; firstFallYear: number } {
  const shape = frostSeasonShape(lastSpring, firstFall);
  return {
    lastSpringYear: shape === 'spring-prior-year' ? year - 1 : year,
    firstFallYear: shape === 'fall-next-year' ? year + 1 : year
  };
}

/** Local-midnight ms of both frost dates for season `year`; a missing or
 *  unreadable date uses the Loudoun default. */
export function frostDatesFromMmDd(
  year: number,
  lastMmDd: string | null | undefined,
  firstMmDd: string | null | undefined
): { lastSpringFrostMs: number; firstFallFrostMs: number } {
  const last = parseMmDd(lastMmDd ?? undefined) ?? parseMmDd(LOUDOUN_DEFAULT_LAST_FROST_MMDD)!;
  const first = parseMmDd(firstMmDd ?? undefined) ?? parseMmDd(LOUDOUN_DEFAULT_FIRST_FROST_MMDD)!;
  const years = frostSeasonYears(year, last, first);
  return {
    lastSpringFrostMs: new Date(years.lastSpringYear, last.month, last.day).getTime(),
    firstFallFrostMs: new Date(years.firstFallYear, first.month, first.day).getTime()
  };
}
