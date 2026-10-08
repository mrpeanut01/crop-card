import { t } from '$lib/i18n';
import { intlLocale } from '$lib/prefs';
import { dateTimeFormat } from '$lib/intlCache';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

export interface MonthOption {
  key: string;
  label: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthLabel(d: Date, locale?: string | null): string {
  if (!locale || locale === 'en') return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  return dateTimeFormat(intlLocale(locale), { month: 'long', year: 'numeric' }).format(d);
}

/** The last `count` months, newest first, keyed `YYYY-MM`. */
export function recentMonths(now: Date, count = 12, locale?: string | null): MonthOption[] {
  const out: MonthOption[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
      label: monthLabel(d, locale)
    });
  }
  return out;
}

/** Picker key for a stand put in before the months listed, such as an
 *  established hayfield or orchard. */
export const OLDER_KEY = 'older';

export const OLDER_OPTION: MonthOption = { key: OLDER_KEY, label: 'More than a year ago' };

export function olderOption(locale?: string | null): MonthOption {
  return { key: OLDER_KEY, label: t(locale, 'setup.plant.olderThanYear') };
}

/** Mid-month for a `YYYY-MM` key, never later than today. `older` picks the
 *  same month two years back as an editable starting point. */
export function dateForMonth(key: string, now: Date): string | null {
  if (key === OLDER_KEY) return ymd(new Date(now.getFullYear() - 2, now.getMonth(), 15));
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const mid = new Date(year, month - 1, 15);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return ymd(mid > today ? today : mid);
}

/** Local noon on a `YYYY-MM-DD` date, so a time zone shift never moves
 *  the planting to the neighbouring day. Rejects dates after `now`. */
export function plantingDateMs(date: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  if (
    d.getFullYear() !== Number(m[1]) ||
    d.getMonth() !== Number(m[2]) - 1 ||
    d.getDate() !== Number(m[3])
  ) {
    return null;
  }
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (d.getTime() > endOfToday.getTime()) return null;
  return d.getTime();
}
