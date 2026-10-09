/**
 * #720 ruling R720-2: a source's calendar words ("February or early March",
 * "late March") as a month/day window. "early" is days 1-10, "mid" 11-20,
 * "late" 21 to the end of the month; a bare month is the whole month.
 * February ends on the 28th so the window exists every year. Parts joined
 * by "or" or "to" span from the first part's start to the last part's end.
 */

export interface MonthDay {
  month: number;
  day: number;
}

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
  const m = /^(early|mid|late)?\s*([a-z]+)$/.exec(words.trim().toLowerCase());
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

/** The first [start, end] of a yearly month/day window that starts after
 *  `afterMs`, as UTC epoch ms at the start of each day. */
export function nextCalendarWindow(
  window: { start: MonthDay; end: MonthDay },
  afterMs: number
): { startMs: number; endMs: number } {
  let year = new Date(afterMs).getUTCFullYear();
  let startMs = Date.UTC(year, window.start.month - 1, window.start.day);
  if (startMs <= afterMs) startMs = Date.UTC(++year, window.start.month - 1, window.start.day);
  const crosses =
    window.end.month < window.start.month ||
    (window.end.month === window.start.month && window.end.day < window.start.day);
  const endMs = Date.UTC(crosses ? year + 1 : year, window.end.month - 1, window.end.day);
  return { startMs, endMs };
}
