import type { MonthDay } from '../plugins/schemas';

export interface MonthDayWindow {
  start: MonthDay;
  end: MonthDay;
}

/** `local` counts days in the process time zone, `utc` in UTC. `endOfDay`
 *  ends the window 1 ms before the day after `end`; `startOfDay` ends it at
 *  the start of `end`. */
export interface MonthDayWindowBasis {
  zone: 'local' | 'utc';
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
  return zone === 'utc' ? Date.UTC(year, month - 1, day) : new Date(year, month - 1, day).getTime();
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
