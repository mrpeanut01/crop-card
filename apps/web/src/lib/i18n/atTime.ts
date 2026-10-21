/** "at 1:00 PM" as one phrase, because Spanish says "a la 1:00" at one
 *  o'clock and "a las 2:00" at every other hour (#868). Client-safe. The
 *  `clock` style is for English sentences that take no "at" ("fetched
 *  2:00 PM"); Spanish still needs its article there. */

import { t } from '$lib/i18n';
import { formatInstant, type Prefs } from '$lib/prefs';

export type AtStyle = 'at' | 'clock';

type Loc = string | null | undefined;

const HHMM = /^\d{1,2}:\d{2}$/;

/** The hour as the clock text shows it: 1 for "1:00 p.m.", 13 for "13:00". */
export function shownHour(time: string): number {
  const m = /\d+/.exec(time);
  return m ? Number(m[0]) : Number.NaN;
}

/** The phrase around clock text that is already formatted. */
export function atText(time: string, locale?: Loc, style: AtStyle = 'at'): string {
  const hour = shownHour(time);
  return t(locale, style === 'clock' ? 'core.clock' : 'core.at', {
    count: Number.isFinite(hour) ? hour : 0,
    time
  });
}

/** The phrase for an instant in `prefs`' zone, or for a stored `HH:MM`
 *  clock value ("06:00" reads "6:00"). */
export function atTime(
  value: Date | number | string,
  prefs: Pick<Prefs, 'timeZone' | 'locale'>,
  style: AtStyle = 'at'
): string {
  const time =
    typeof value === 'string' && HHMM.test(value)
      ? value.replace(/^0(\d)/, '$1')
      : formatInstant(value, { units: 'us', ...prefs }, 'time');
  return atText(time, prefs.locale, style);
}
