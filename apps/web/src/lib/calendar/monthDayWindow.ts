import type { MonthDay } from '../plugins/schemas';
import { zonedDayStartMs } from '$lib/exports/dateRange';

export interface MonthDayWindow {
  start: MonthDay;
  end: MonthDay;
}

/** `local` counts days in the process time zone, `utc` in UTC and
 *  `{ timeZone }` in that IANA zone. `endOfDay`
 *  ends the window 1 ms before the day after `end`; `startOfDay` ends it at
 *  the start of `end`. */
export interface MonthDayWindowBasis {
  zone: 'local' | 'utc' | { timeZone: string };
  end: 'endOfDay' | 'startOfDay';
}

/** An end before the start runs into the next year. */
export function crossesNewYear(window: MonthDayWindow): boolean {
  const { start, end } = window;
  return end.month < start.month || (end.month === start.month && end.day < start.day);
}

function dayStartMs(
  zone: MonthDayWindowBasis['zone'],
  year: number,
  month: number,
  day: number
): number {
  if (zone === 'utc') return Date.UTC(year, month - 1, day);
  if (zone === 'local') return new Date(year, month - 1, day).getTime();
  return zonedDayStartMs(year, month, day, zone.timeZone);
}

/** The yearly window that starts in `year`, as epoch ms. */
export function projectMonthDayWindow(
  window: MonthDayWindow,
  year: number,
  basis: MonthDayWindowBasis
): { startMs: number; endMs: number } {
  const { start, end } = window;
  const endYear = crossesNewYear(window) ? year + 1 : year;
  const startMs = dayStartMs(basis.zone, year, start.month, start.day);
  const endMs =
    basis.end === 'endOfDay'
      ? dayStartMs(basis.zone, endYear, end.month, end.day + 1) - 1
      : dayStartMs(basis.zone, endYear, end.month, end.day);
  return { startMs, endMs };
}
