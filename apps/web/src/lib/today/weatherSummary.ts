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

/** Rain chance at or above which the strip and the calendar mention rain. */
export const RAIN_POP_PCT = 30;

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
  const next = days.slice(0, 3).filter((d) => d.popPct >= RAIN_POP_PCT);
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

/** One forecast day as the calendar cells and the forecast sheet show it. */
export interface DayWeather {
  date: string;
  sky: WeatherSky;
  highF: number;
  lowF: number;
  popPct: number;
  windMph?: number;
  shortForecast?: string;
  /** Only tonight is left in the forecast, so there is no daytime high. */
  overnightOnly: boolean;
}

export function forecastDays(days: ForecastDay[] | null | undefined): DayWeather[] {
  if (!days) return [];
  const out: DayWeather[] = [];
  for (const d of days) {
    if (!d || typeof d.date !== 'string') continue;
    if (!Number.isFinite(d.highF) || !Number.isFinite(d.lowF)) continue;
    const night = d.overnightOnly === true;
    out.push({
      date: d.date,
      sky: skyFor(d.shortForecast, night),
      highF: Math.round(d.highF),
      lowF: Math.round(d.lowF),
      popPct: Number.isFinite(d.popPct) ? Math.round(d.popPct) : 0,
      windMph: d.windMph !== undefined ? Math.round(d.windMph) : undefined,
      shortForecast: d.shortForecast,
      overnightOnly: night
    });
  }
  return out;
}

export function weatherByDate(days: readonly DayWeather[]): Record<string, DayWeather> {
  const out: Record<string, DayWeather> = {};
  for (const d of days) out[d.date] = d;
  return out;
}

export type TodayWeatherSource = 'block' | 'farm';

export type TodayWeather =
  | {
      status: 'ok';
      summary: WeatherSummary;
      source: TodayWeatherSource;
      days: DayWeather[];
      fetchedAt: number;
    }
  | { status: 'needs-location' }
  | { status: 'unavailable' };
