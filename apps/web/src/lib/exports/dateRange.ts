/**
 * Shared date-range parsing for record exports (#325).
 *
 * The /records UI passes `from` / `to` as ISO date strings (e.g.
 * `2026-01-01`), matching the loader at routes/records/+page.server.ts.
 * Export endpoints previously did `Number(param)` which turns a date
 * string into `NaN`, silently dropping the filter. This parses both
 * epoch-millisecond and ISO-date inputs, and treats `to` as inclusive
 * of the whole day (same convention as the /records loader). Date-only
 * values are days on the user's calendar, so they resolve to midnight in
 * the user's time zone rather than UTC.
 */

import { DEFAULT_PREFS, type Prefs } from '$lib/prefs';

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return wall - Math.floor(at / 1000) * 1000;
}

/** Epoch ms of 00:00 on calendar day (y, m, d) in `timeZone`. */
export function zonedDayStartMs(y: number, m: number, d: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

function parseMs(raw: string | null, timeZone: string): number | undefined {
  if (!raw) return undefined;
  // Bare integer → epoch ms.
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  const ymd = YMD.exec(raw);
  if (ymd) {
    const ms = zonedDayStartMs(+ymd[1], +ymd[2], +ymd[3], timeZone);
    return Number.isNaN(ms) ? undefined : ms;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export interface ExportDateRange {
  fromMs: number | undefined;
  toMs: number | undefined;
}

export function parseExportDateRange(
  params: URLSearchParams,
  prefs: Pick<Prefs, 'timeZone'> = DEFAULT_PREFS
): ExportDateRange {
  const fromMs = parseMs(params.get('from'), prefs.timeZone);
  const toParam = params.get('to');
  // An ISO date `to` covers that whole day in the user's zone; epoch-ms
  // `to` is used verbatim.
  const ymd = YMD.exec(toParam ?? '');
  const toMs = ymd
    ? zonedDayStartMs(+ymd[1], +ymd[2], +ymd[3] + 1, prefs.timeZone) - 1
    : parseMs(toParam, prefs.timeZone);
  return { fromMs, toMs: Number.isNaN(toMs) ? undefined : toMs };
}
