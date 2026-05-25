/**
 * /today weather strip summary (Phase 25e · #97).
 *
 * Compresses a 3-day NOAA NWS forecast into the one-line strip the
 * Almanac /today header renders ("68°F · 6 mph SW · 0.4 in tue→wed").
 *
 * The fetch is best-effort: if no block has geometry or NWS errors out,
 * `summarizeForecastSafely` returns `null` and the UI hides the strip.
 */

import type { ForecastDay } from '$lib/hay/types';

export interface WeatherSummary {
  /** Today's high (°F). */
  tempF: number;
  /** Today's mean wind speed (mph), if reported. */
  windMph?: number;
  /** Free-form forecast string for today ("Mostly sunny"). */
  shortForecast?: string;
  /** "0.4 in tue→wed" style rain hint covering the next 2 days, if any
   *  daily POP ≥ 30%. Undefined when the period is dry. */
  rainHint?: string;
}

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d
    .toLocaleDateString('en-US', { weekday: 'short' })
    .toLowerCase();
}

export function summarizeForecast(days: ForecastDay[]): WeatherSummary | null {
  const today = days[0];
  if (!today) return null;
  const summary: WeatherSummary = {
    tempF: Math.round(today.highF),
    windMph: today.windMph !== undefined ? Math.round(today.windMph) : undefined,
    shortForecast: today.shortForecast
  };
  const next = days.slice(0, 3).filter((d) => d.popPct >= 30);
  if (next.length === 1) {
    summary.rainHint = `${next[0].popPct}% rain ${dayLabel(next[0].date)}`;
  } else if (next.length >= 2) {
    summary.rainHint = `rain ${dayLabel(next[0].date)}→${dayLabel(next[next.length - 1].date)}`;
  }
  return summary;
}

/** Wrap `summarizeForecast` so any error → null and never crashes the page. */
export function summarizeForecastSafely(days: ForecastDay[] | null | undefined): WeatherSummary | null {
  if (!days || days.length === 0) return null;
  try {
    return summarizeForecast(days);
  } catch {
    return null;
  }
}
