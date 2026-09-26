/** Rows the /records ledger renders before "Load more". The summary,
 *  kind-chip counts and every export still cover the full filtered set. */
export const RECORDS_PAGE_SIZE = 50;

/** Upper bound on `?show=`, so a hand-edited URL cannot ask the page to
 *  render an unbounded ledger. Past it, the exports carry the full set. */
export const RECORDS_MAX_SHOW = 2000;

/** Parses `?show=` into a row count: a positive integer rounded up to a
 *  whole page and capped at `RECORDS_MAX_SHOW`. Anything else is one page. */
export function parseShow(raw: string | null): number {
  if (!raw || !/^\d{1,7}$/.test(raw)) return RECORDS_PAGE_SIZE;
  const n = Number(raw);
  if (n <= 0) return RECORDS_PAGE_SIZE;
  return Math.min(Math.ceil(n / RECORDS_PAGE_SIZE) * RECORDS_PAGE_SIZE, RECORDS_MAX_SHOW);
}

export interface RecordsPage<T> {
  rows: T[];
  total: number;
  /** The `?show=` value for "Load more", or null when nothing is hidden. */
  nextShow: number | null;
}

export function pageOf<T>(rows: T[], show: number): RecordsPage<T> {
  const total = rows.length;
  const nextShow =
    total > show && show < RECORDS_MAX_SHOW
      ? Math.min(show + RECORDS_PAGE_SIZE, RECORDS_MAX_SHOW)
      : null;
  return { rows: total > show ? rows.slice(0, show) : rows, total, nextShow };
}
