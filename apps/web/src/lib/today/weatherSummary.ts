/**
 * /today weather strip summary (Phase 25e · #97).
 *
 * Compresses a 3-day NOAA NWS forecast into the one-line strip the
 * Almanac /today header renders ("68°F · 6 mph SW · 0.4 in tue→wed").
 *
 * The fetch is best-effort: `summarizeForecastSafely` returns `null` on an
 * empty or malformed forecast and the loader reports the strip as unavailable.
 */

import type { ForecastDay } from '$lib/hay/types';
import { formatCalendarDate } from '$lib/prefs';

export type WeatherSky =
  | 'clear'
  | 'clear-night'
  | 'partly'
  | 'partly-night'
  | 'cloudy'
  | 'rain'
  | 'storm'
  | 'snow'
  | 'fog';

export interface WeatherSummary {
  /** Today's high, or tonight's low once only the overnight period is left
   *  (°F, stored US; the strip converts for display). */
  tempF: number;
  tempKind: 'high' | 'low';
  sky: WeatherSky;
  /** Today's mean wind speed (mph), if reported. */
  windMph?: number;
  /** Free-form forecast string for today ("Mostly sunny"). */
  shortForecast?: string;
  /** "0.4 in tue→wed" style rain hint covering the next 2 days, if any
   *  daily POP ≥ 30%. Undefined when the period is dry. */
  rainHint?: string;
}

function dayLabel(iso: string): string {
  return formatCalendarDate(iso, 'weekday').toLowerCase();
}

export function skyFor(shortForecast: string | undefined, night: boolean): WeatherSky {
  const f = (shortForecast ?? '').toLowerCase();
  if (/thunder|t-storm/.test(f)) return 'storm';
  if (/snow|sleet|flurr|ice|freezing/.test(f)) return 'snow';
  if (/rain|shower|drizzle/.test(f)) return 'rain';
  if (/fog|haze|smoke|mist/.test(f)) return 'fog';
  if (/partly/.test(f)) return night ? 'partly-night' : 'partly';
  if (/cloud|overcast/.test(f)) return 'cloudy';
  return night ? 'clear-night' : 'clear';
}

export function summarizeForecast(days: ForecastDay[]): WeatherSummary | null {
  const today = days[0];
  if (!today) return null;
  const night = today.overnightOnly === true;
  const summary: WeatherSummary = {
    tempF: Math.round(night ? today.lowF : today.highF),
    tempKind: night ? 'low' : 'high',
    sky: skyFor(today.shortForecast, night),
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
export function summarizeForecastSafely(
  days: ForecastDay[] | null | undefined
): WeatherSummary | null {
  if (!days || days.length === 0) return null;
  try {
    return summarizeForecast(days);
  } catch {
    return null;
  }
}

export type TodayWeatherSource = 'block' | 'farm';

export type TodayWeather =
  | { status: 'ok'; summary: WeatherSummary; source: TodayWeatherSource }
  | { status: 'needs-location' }
  | { status: 'unavailable' };
