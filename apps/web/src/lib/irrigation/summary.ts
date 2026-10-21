/** Plain words for an automatic waterer's program (Phase 37E). Client-safe;
 *  English without a locale. */

import { t } from '$lib/i18n';
import { atText } from '$lib/i18n/atTime';
import { dateTimeFormat } from '$lib/intlCache';
import { intlLocale } from '$lib/prefs';
import type { IrrigationSchedule } from './apiSchemas';

type Loc = string | null | undefined;

/** Monday first, the order a timer's day buttons usually read. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** 2026-01-04 was a Sunday; day `d` is that date plus `d` days. */
export function weekdayName(day: number, locale?: Loc, style: 'short' | 'long' = 'short'): string {
  return dateTimeFormat(intlLocale(locale), { weekday: style, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, 0, 4 + day))
  );
}

/** "06:00" reads "6:00". */
export function startText(start: string): string {
  return start.replace(/^0(\d)/, '$1');
}

/** "Mon, Wed, Fri 6:00 for 20 min". */
export function scheduleSummary(
  schedule: Pick<IrrigationSchedule, 'days' | 'start' | 'minutes'>,
  locale?: Loc
): string {
  const days =
    schedule.days.length === 7
      ? t(locale, 'herbse.schedule.everyDay')
      : WEEKDAY_ORDER.filter((d) => schedule.days.includes(d))
          .map((d) => weekdayName(d, locale))
          .join(', ');
  return t(locale, 'herbse.schedule.summary', {
    days,
    at: atText(startText(schedule.start), locale, 'clock'),
    minutes: String(schedule.minutes)
  });
}

/** "Drip timer: Mon, Wed, Fri 6:00 for 20 min", with the amount when typed. */
export function watererLine(
  label: string,
  schedule: Pick<IrrigationSchedule, 'days' | 'start' | 'minutes' | 'inchesPerRun'>,
  locale?: Loc
): string {
  const summary = scheduleSummary(schedule, locale);
  const inches = schedule.inchesPerRun ?? null;
  return inches === null
    ? t(locale, 'herbse.schedule.line', { label, summary })
    : t(locale, 'herbse.schedule.lineInches', {
        label,
        summary,
        inches: `${Math.round(inches * 100) / 100} in`
      });
}
