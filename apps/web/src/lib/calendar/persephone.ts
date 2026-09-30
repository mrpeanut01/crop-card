/**
 * Short days for the sowing calendar (E3-6): the date spans when daylight is
 * under 10 hours at the farm. Sunrise and sunset come from the pure NOAA
 * equations in `lib/safety/sunTimes.ts` (read only), which use the standard
 * -0.833° solar altitude. Pure and client-safe.
 */

import { sunTimesFor } from '$lib/safety/sunTimes';

export const SHORT_DAY_HOURS = 10;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface ShortDaySpan {
  /** Sunrise of the first day under the threshold. */
  startMs: number;
  /** Sunset of the last day under the threshold. */
  endMs: number;
}

export type ShortDays =
  { status: 'no-location' } | { status: 'never' } | { status: 'spans'; spans: ShortDaySpan[] };

/** Hours of daylight on the local solar day holding `at`, or null when the
 *  sun does not rise or set that day (polar day or night). */
export function daylightHours(lat: number, lon: number, at: number): number | null {
  const t = sunTimesFor(lat, lon, new Date(at));
  if (!t) return null;
  return (t.sunset.getTime() - t.sunrise.getTime()) / HOUR_MS;
}

/** Local solar noon (UTC ms) of the solar day holding `at`. */
function solarNoon(at: number, lon: number): number {
  const offset = -lon * 4 * 60_000;
  const dayIndex = Math.floor((at - offset) / DAY_MS);
  return dayIndex * DAY_MS + DAY_MS / 2 + offset;
}

/** True when some day of the year has less than `hours` of daylight here.
 *  Checks the week around both solstices, so it covers either hemisphere. */
export function hasShortDays(lat: number, lon: number, hours = SHORT_DAY_HOURS): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const year = 2025;
  for (const [month, day] of [
    [5, 21],
    [11, 21]
  ] as const) {
    for (let d = -3; d <= 3; d++) {
      const h = daylightHours(lat, lon, Date.UTC(year, month, day + d, 12));
      if (h === null) return Math.abs(lat) > 60;
      if (h < hours) return true;
    }
  }
  return false;
}

/**
 * Spans of consecutive days under `hours` of daylight that touch
 * [fromMs, toMs]. A span that runs past either end is clipped to it. Days
 * with no sunrise or sunset (polar night) count as short; polar day does not.
 */
export function shortDaySpans(
  lat: number | null,
  lon: number | null,
  fromMs: number,
  toMs: number,
  hours = SHORT_DAY_HOURS
): ShortDays {
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { status: 'no-location' };
  }
  if (!hasShortDays(lat, lon, hours)) return { status: 'never' };

  const spans: ShortDaySpan[] = [];
  let open: ShortDaySpan | null = null;
  for (let noon = solarNoon(fromMs, lon); noon <= toMs + DAY_MS; noon += DAY_MS) {
    const t = sunTimesFor(lat, lon, new Date(noon));
    const polarNight = !t && lat > 0 === isNorthernWinter(noon);
    const short = t ? (t.sunset.getTime() - t.sunrise.getTime()) / HOUR_MS < hours : polarNight;
    if (short) {
      const start = t ? t.sunrise.getTime() : noon - DAY_MS / 2;
      const end = t ? t.sunset.getTime() : noon + DAY_MS / 2;
      if (open) open.endMs = end;
      else open = { startMs: start, endMs: end };
    } else if (open) {
      spans.push(open);
      open = null;
    }
  }
  if (open) spans.push(open);
  const clipped = spans
    .filter((s) => s.endMs >= fromMs && s.startMs <= toMs)
    .map((s) => ({ startMs: Math.max(s.startMs, fromMs), endMs: Math.min(s.endMs, toMs) }));
  return { status: 'spans', spans: clipped };
}

function isNorthernWinter(ms: number): boolean {
  const m = new Date(ms).getUTCMonth();
  return m >= 9 || m <= 2;
}

/** The band may carry the name "Persephone period" only while
 *  `scripts/calendar-sources.json` quotes a source for it (E3-6); the gate
 *  test holds the two together. */
export const PERSEPHONE_NAME_SOURCED = true;

export function shortDayBandLabel(): string {
  return PERSEPHONE_NAME_SOURCED
    ? `Persephone period: under ${SHORT_DAY_HOURS} hours of daylight`
    : `Under ${SHORT_DAY_HOURS} hours of daylight`;
}
