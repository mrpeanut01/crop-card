/**
 * /today views: Day is the task card deck, Week and Month are calendar
 * grids and Season is a timeline. Pure and client-safe.
 */

export type TodayView = 'day' | 'week' | 'month' | 'season';

export const TODAY_VIEWS: { id: TodayView; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'season', label: 'Season' }
];

const DAY_MS = 86_400_000;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function clampTodayView(raw: string | null | undefined): TodayView {
  return raw === 'week' || raw === 'month' || raw === 'season' ? raw : 'day';
}

const LEGACY_TAB: Record<string, TodayView> = {
  today: 'day',
  '7d': 'week',
  '30d': 'month',
  season: 'season'
};

/**
 * The view a /today URL asks for, plus the canonical search string when the
 * URL used the old `?tab=` windows or `?view=list|calendar`. Old bookmarks
 * keep working: `?tab=7d` is the Week calendar, `?tab=30d` the Month
 * calendar and `?view=list` the Day cards.
 */
export function resolveTodayParams(search: URLSearchParams): {
  view: TodayView;
  redirect: string | null;
} {
  const tab = search.get('tab');
  const rawView = search.get('view');
  const legacyView = rawView === 'list' || rawView === 'calendar';
  if (tab === null && !legacyView) return { view: clampTodayView(rawView), redirect: null };

  let view: TodayView;
  const fromTab = tab !== null ? LEGACY_TAB[tab] : undefined;
  if (rawView === 'list') view = 'day';
  else if (rawView === 'calendar') view = fromTab && fromTab !== 'day' ? fromTab : 'week';
  else if (fromTab) view = rawView && !legacyView ? clampTodayView(rawView) : fromTab;
  else view = clampTodayView(rawView);

  const next = new URLSearchParams(search);
  next.delete('tab');
  if (view === 'day') next.delete('view');
  else next.set('view', view);
  const qs = next.toString();
  return { view, redirect: qs ? `?${qs}` : '' };
}

export function isYmd(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  const m = YMD.exec(raw);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === raw;
}

export function addDaysYmd(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday. */
export function weekdayOfYmd(ymd: string): number {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}

export function startOfWeekYmd(ymd: string, firstDay: number): string {
  const back = (weekdayOfYmd(ymd) - firstDay + 7) % 7;
  return addDaysYmd(ymd, -back);
}

export function startOfMonthYmd(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function addMonthsYmd(ymd: string, months: number): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7)) - 1 + months;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 10);
}

export interface CalendarGrid {
  /** First and last day shown, inclusive. */
  fromYmd: string;
  toYmd: string;
  /** Rows of seven days. */
  weeks: string[][];
  /** The month being shown (`YYYY-MM`), for Month; null for Week. */
  month: string | null;
}

/** The calendar-aligned grid holding `anchor` for Week or Month. Month
 *  grids run whole weeks, so they start and end with the neighbouring
 *  months' days. */
export function calendarGrid(
  view: 'week' | 'month',
  anchor: string,
  firstDay: number
): CalendarGrid {
  const from =
    view === 'week'
      ? startOfWeekYmd(anchor, firstDay)
      : startOfWeekYmd(startOfMonthYmd(anchor), firstDay);
  const lastOfMonth = addDaysYmd(addMonthsYmd(anchor, 1), -1);
  const weekCount =
    view === 'week'
      ? 1
      : Math.ceil(
          (Date.parse(`${lastOfMonth}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) + DAY_MS) /
            (7 * DAY_MS)
        );
  const weeks: string[][] = [];
  for (let w = 0; w < weekCount; w++) {
    const row: string[] = [];
    for (let d = 0; d < 7; d++) row.push(addDaysYmd(from, w * 7 + d));
    weeks.push(row);
  }
  const last = weeks[weeks.length - 1];
  return {
    fromYmd: from,
    toYmd: last[last.length - 1],
    weeks,
    month: view === 'month' ? anchor.slice(0, 7) : null
  };
}

/** The anchor one page back (-1) or forward (+1). */
export function shiftAnchor(view: 'week' | 'month', anchor: string, dir: -1 | 1): string {
  return view === 'week' ? addDaysYmd(anchor, dir * 7) : addMonthsYmd(anchor, dir);
}
