import { getForecast, WeatherFetchError } from '$lib/server/weather';
import { resolveWeatherLocation } from '$lib/server/weatherHourly';
import { summarizeForecastSafely, type TodayWeather } from '$lib/today/weatherSummary';

/**
 * The /today strip uses the first mapped block, then the saved farm location.
 * The Loudoun default is never shown as if it were the farm's weather; the
 * strip asks for a location instead. NWS failures never throw.
 */
export async function loadTodayWeather(): Promise<TodayWeather> {
  const location = resolveWeatherLocation(null);
  if (!location || location.source === 'farm-default') return { status: 'needs-location' };
  let summary;
  try {
    summary = summarizeForecastSafely(await getForecast(location.lat, location.lon));
  } catch (e) {
    if (!(e instanceof WeatherFetchError)) console.error('[today] weather fetch failed:', e);
    return { status: 'unavailable' };
  }
  if (!summary) return { status: 'unavailable' };
  return { status: 'ok', summary, source: location.source === 'farm' ? 'farm' : 'block' };
}
