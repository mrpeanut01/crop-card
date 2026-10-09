/**
 * #820: the words for a label season cap and for the kernel's verdict on
 * one pass (`lib/safety/seasonCap.ts`). An unknown verdict never gives a
 * total or what is left (ruling SC-2); it says what can't be counted.
 */

import { t, type TranslateKey } from '$lib/i18n';
import { numberToLocaleString } from '$lib/intlCache';
import { intlLocale } from '$lib/prefs';
import type { SeasonCapPeriod, SeasonCapUnknown } from '$lib/safety/seasonCap';

export interface SeasonCapLike {
  amount: number;
  unit: string;
  period: SeasonCapPeriod;
}

/** What the endpoints send back for one product and cap. */
export interface SeasonCapVerdictLike {
  pluginId: string;
  displayName: string;
  cap: SeasonCapLike;
  knownTotal: number;
  unknownIds: string[];
  unknown: SeasonCapUnknown[];
  status: 'within' | 'over' | 'unknown';
}

function num(n: number, locale?: string | null): string {
  return numberToLocaleString(Math.round(n * 1000) / 1000, intlLocale(locale), {
    maximumFractionDigits: 3
  });
}

function unitText(unit: string): string {
  return unit === 'fl-oz' ? 'fl oz' : unit;
}

export function seasonCapPeriodText(period: SeasonCapPeriod, locale?: string | null): string {
  return t(locale, `sprayui.seasonCap.period.${period}` as TranslateKey);
}

/** "Up to 1.5 pt/acre per crop year" */
export function seasonCapLimitText(cap: SeasonCapLike, locale?: string | null): string {
  return t(locale, 'sprayui.seasonCap.limit', {
    amount: num(cap.amount, locale),
    unit: unitText(cap.unit),
    period: seasonCapPeriodText(cap.period, locale)
  });
}

/** The verdict sentence, then the reasons an amount could not be counted. */
export function seasonCapVerdictLines(
  v: SeasonCapVerdictLike,
  locale?: string | null
): { headline: string; reasons: string[]; note: string } {
  const params = {
    product: v.displayName,
    total: num(v.knownTotal, locale),
    cap: num(v.cap.amount, locale),
    unit: unitText(v.cap.unit),
    period: seasonCapPeriodText(v.cap.period, locale)
  };
  const headline =
    v.status === 'within'
      ? t(locale, 'sprayui.seasonCap.within', params)
      : v.status === 'over'
        ? t(locale, 'sprayui.seasonCap.over', params)
        : t(locale, 'sprayui.seasonCap.unknown', params);
  const reasons =
    v.status === 'within'
      ? []
      : v.unknown.map((r) =>
          t(locale, `sprayui.seasonCap.unknown.${r}` as TranslateKey, {
            count: v.unknownIds.length
          })
        );
  const note = t(
    locale,
    v.cap.period === '365-days' ? 'sprayui.seasonCap.rollingNote' : 'sprayui.seasonCap.calendarNote'
  );
  return { headline, reasons, note };
}
