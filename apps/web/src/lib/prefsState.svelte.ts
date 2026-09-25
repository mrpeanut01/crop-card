import { page } from '$app/state';
import {
  DEFAULT_PREFS,
  formatCalendarDate,
  formatInstant,
  formatLabelRate,
  formatQuantity,
  fromDisplay,
  todayYmd,
  toDisplay,
  unitLabel,
  zoneAbbrev,
  type DateStyle,
  type FormatOpts,
  type Prefs,
  type Quantity
} from './prefs';

/** The signed-in user's display preferences, from the root layout load.
 *  Reading it inside a template or `$derived` keeps it reactive. */
export function currentPrefs(): Prefs {
  return (page.data as { prefs?: Prefs }).prefs ?? DEFAULT_PREFS;
}

/** Formatting bound to the current user's preferences, for components.
 *  Server code (exports, PDFs) calls the `$lib/prefs` functions with
 *  `prefsFor(userId)` instead. */
export const fmt = {
  instant: (
    v: Date | number | string | null | undefined,
    style?: DateStyle,
    extra?: Intl.DateTimeFormatOptions
  ) => formatInstant(v, currentPrefs(), style, extra),
  day: formatCalendarDate,
  qty: (v: number | null | undefined, q: Quantity, opts?: FormatOpts) =>
    formatQuantity(v, q, currentPrefs(), opts),
  label: (v: number | null | undefined, q: Quantity, opts?: FormatOpts) =>
    formatLabelRate(v, q, currentPrefs(), opts),
  unit: (q: Quantity) => unitLabel(q, currentPrefs()),
  toDisplay: (v: number, q: Quantity) => toDisplay(v, q, currentPrefs()),
  fromDisplay: (v: number, q: Quantity) => fromDisplay(v, q, currentPrefs()),
  today: () => todayYmd(currentPrefs()),
  zone: (at?: Date | number | string) => zoneAbbrev(currentPrefs(), at)
};
