/** 33B (B-42): `from` and `to` for the treatment log and the certifier
 *  pack. Farm-local `YYYY-MM-DD`, both required, `to` not before `from`, at
 *  most 10 years apart, parsed with the shared export date parser. */

import { parseExportDateRange } from '$lib/exports/dateRange';
import type { Prefs } from '$lib/prefs';

export const MAX_WINDOW_YEARS = 10;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ExportWindowResult =
  | { ok: true; fromMs: number; toMs: number; from: string; to: string }
  | { ok: false; field: 'from' | 'to'; message: string };

function realDay(s: string): boolean {
  const m = YMD.exec(s);
  if (!m) return false;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function parseExportWindow(
  params: URLSearchParams,
  prefs: Pick<Prefs, 'timeZone'>
): ExportWindowResult {
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  if (!from) return { ok: false, field: 'from', message: 'Pick a start date (from).' };
  if (!realDay(from)) {
    return {
      ok: false,
      field: 'from',
      message: 'The start date (from) must look like 2026-01-31.'
    };
  }
  if (!to) return { ok: false, field: 'to', message: 'Pick an end date (to).' };
  if (!realDay(to)) {
    return { ok: false, field: 'to', message: 'The end date (to) must look like 2026-12-31.' };
  }
  if (to < from) {
    return { ok: false, field: 'to', message: 'The end date (to) is before the start date.' };
  }
  const [fy, fm, fd] = from.split('-').map(Number);
  const limit = `${String(fy + MAX_WINDOW_YEARS).padStart(4, '0')}-${String(fm).padStart(2, '0')}-${String(fd).padStart(2, '0')}`;
  if (to >= limit) {
    return {
      ok: false,
      field: 'to',
      message: `Pick a window of at most ${MAX_WINDOW_YEARS} years.`
    };
  }
  const range = parseExportDateRange(new URLSearchParams({ from, to }), prefs);
  if (range.fromMs === undefined || range.toMs === undefined) {
    return { ok: false, field: 'from', message: 'Those dates could not be read.' };
  }
  return { ok: true, fromMs: range.fromMs, toMs: range.toMs, from, to };
}

export function windowRefusal(r: Extract<ExportWindowResult, { ok: false }>): Response {
  return new Response(
    JSON.stringify({
      error: 'invalid request',
      message: r.message,
      issues: [{ path: r.field, message: r.message }]
    }),
    {
      status: 400,
      headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' }
    }
  );
}
