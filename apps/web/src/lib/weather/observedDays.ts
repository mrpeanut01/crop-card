/**
 * Phase 37D (R-9): the last days of observed highs and lows for the /today
 * conditions sheet, from the hourly NOAA observations `GET
 * /api/weather/observed` returns. Display only; nothing reads it. Pure and
 * client-safe.
 */

import type { HourlyPoint } from './leafWet';
import { ymdInZone } from '$lib/prefs';

export const OBSERVED_DAYS_SHOWN = 7;
const DAY_MS = 86_400_000;
/** A day with fewer readings than its shortest possible length (the spring
 *  clock change) is partial. */
const MIN_FULL_DAY_HOURS = 23;

export interface ObservedDay {
  /** The farm-local day, `YYYY-MM-DD`. */
  date: string;
  highF: number | null;
  lowF: number | null;
  /** Hours with a temperature reading that day. */
  hours: number;
  /** Some hourly readings are missing, so the high or low may be off. */
  partial: boolean;
}

function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(ymd) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * One row per farm-local day for the `days` full days before today, oldest
 * first. A day with no reading has null high and low; the high and low are
 * the warmest and coldest hourly readings, never filled in.
 */
export function observedDays(
  hours: readonly Pick<HourlyPoint, 't' | 'tempF'>[],
  now: number,
  timeZone: string,
  days: number = OBSERVED_DAYS_SHOWN
): ObservedDay[] {
  const today = ymdInZone(now, timeZone);
  const order = Array.from({ length: days }, (_, i) => addDays(today, i - days));
  const byDay = new Map<string, number[]>(order.map((d) => [d, []]));
  for (const h of hours) {
    if (h.tempF === null || !Number.isFinite(h.tempF)) continue;
    byDay.get(ymdInZone(h.t, timeZone))?.push(h.tempF);
  }
  return order.map((date) => {
    const temps = byDay.get(date) ?? [];
    return {
      date,
      highF: temps.length ? Math.max(...temps) : null,
      lowF: temps.length ? Math.min(...temps) : null,
      hours: temps.length,
      partial: temps.length > 0 && temps.length < MIN_FULL_DAY_HOURS
    };
  });
}

/** Where the observed fetch should start: midnight UTC a day before the
 *  first day shown, so every farm-local day is covered. */
export function observedFromMs(now: number, days: number = OBSERVED_DAYS_SHOWN): number {
  const start = new Date(now - (days + 1) * DAY_MS);
  start.setUTCHours(0, 0, 0, 0);
  return start.getTime();
}
