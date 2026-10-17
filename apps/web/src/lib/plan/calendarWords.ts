/**
 * #720 ruling R720-2: a source's calendar words ("February or early March",
 * "late March") as a month/day window. "early" is days 1-10, "mid" 11-20,
 * "late" 21 to the end of the month; a bare month is the whole month.
 * February ends on the 28th so the window exists every year. Parts joined
 * by "or" or "to" span from the first part's start to the last part's end.
 */

import type { MonthDay } from '../plugins/schemas';
import {
  projectMonthDayWindow,
  type MonthDayWindow,
  type MonthDayWindowBasis
} from '../calendar/monthDayWindow';

const PLANNER_WINDOW_BASIS: MonthDayWindowBasis = { zone: 'utc', end: 'startOfDay' };

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
];

const LAST_DAY = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function part(words: string): { start: MonthDay; end: MonthDay } | null {
  const m = /^(?:(early|mid|late)(?:\s*-\s*|\s+))?([a-z]+)$/.exec(words.trim().toLowerCase());
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]) + 1;
  if (month === 0) return null;
  const last = LAST_DAY[month - 1];
  switch (m[1]) {
    case 'early':
      return { start: { month, day: 1 }, end: { month, day: 10 } };
    case 'mid':
      return { start: { month, day: 11 }, end: { month, day: 20 } };
    case 'late':
      return { start: { month, day: 21 }, end: { month, day: last } };
    default:
      return { start: { month, day: 1 }, end: { month, day: last } };
  }
}

/** The window the words name, or null when they are not of that form. */
export function calendarWindowFromWords(words: string): { start: MonthDay; end: MonthDay } | null {
  const parts = words.split(/\s+(?:or|to)\s+/i).map(part);
  if (parts.length === 0 || parts.some((p) => p === null)) return null;
  return { start: parts[0]!.start, end: parts[parts.length - 1]!.end };
}

/** The [start, end] of a yearly month/day window for something that can
 *  happen no earlier than `afterMs`: the rest of the window `afterMs` falls
 *  in (from `afterMs`), else the next window to start. UTC epoch ms at the
 *  start of each day. */
export function nextCalendarWindow(
  window: MonthDayWindow,
  afterMs: number
): { startMs: number; endMs: number } {
  const year = new Date(afterMs).getUTCFullYear();
  for (let y = year - 1; ; y++) {
    const { startMs, endMs } = projectMonthDayWindow(window, y, PLANNER_WINDOW_BASIS);
    if (afterMs > endMs) continue;
    return { startMs: Math.max(startMs, afterMs), endMs };
  }
}
