/**
 * Shared date-range parsing for record exports (#325).
 *
 * The /records UI passes `from` / `to` as ISO date strings (e.g.
 * `2026-01-01`), matching the loader at routes/records/+page.server.ts.
 * Export endpoints previously did `Number(param)` which turns a date
 * string into `NaN`, silently dropping the filter. This parses both
 * epoch-millisecond and ISO-date inputs, and treats `to` as inclusive
 * of the whole day (same convention as the /records loader).
 */

function parseMs(raw: string | null): number | undefined {
  if (!raw) return undefined;
  // Bare integer → epoch ms.
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export interface ExportDateRange {
  fromMs: number | undefined;
  toMs: number | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseExportDateRange(params: URLSearchParams): ExportDateRange {
  const fromMs = parseMs(params.get('from'));
  const toRaw = parseMs(params.get('to'));
  // ISO date `to` is the start of that day; extend to end-of-day so the
  // range is inclusive. Epoch-ms `to` is used verbatim.
  const toIsDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(params.get('to') ?? '');
  const toMs = toRaw === undefined ? undefined : toIsDateOnly ? toRaw + DAY_MS - 1 : toRaw;
  return { fromMs, toMs };
}
