/**
 * Server-only settings reads. Split from `./constants` so client bundles
 * don't pull in `$lib/db/settings` (and the `better-sqlite3` chain behind it).
 *
 * Anything that calls `getSetting()` lives here.
 */

import { getSetting } from '$lib/db/settings';
import {
  DEFAULT_AI_DAILY_QUOTA,
  DEFAULT_AI_MONTHLY_USD_CAP,
  LOUDOUN_DEFAULT_FIRST_FROST_MMDD,
  LOUDOUN_DEFAULT_LAST_FROST_MMDD,
  LOUDOUN_DEFAULT_LAT_LON,
  parseMmDd,
  SETTINGS_KEYS,
  type FarmLatLon
} from './constants';

/**
 * Frost dates for a given year. Reads `last_frost_date` / `first_frost_date`
 * from `app_settings` (MM-DD strings); falls back to Loudoun County, VA
 * defaults (Apr 15 / Oct 15).
 */
export function frostDatesForYear(year: number) {
  const last =
    parseMmDd(getSetting(SETTINGS_KEYS.lastFrost)) ?? parseMmDd(LOUDOUN_DEFAULT_LAST_FROST_MMDD)!;
  const first =
    parseMmDd(getSetting(SETTINGS_KEYS.firstFrost)) ??
    parseMmDd(LOUDOUN_DEFAULT_FIRST_FROST_MMDD)!;
  return {
    lastSpringFrostMs: new Date(year, last.month, last.day).getTime(),
    firstFallFrostMs: new Date(year, first.month, first.day).getTime()
  };
}

export function getFarmLatLon(): FarmLatLon {
  const raw = getSetting(SETTINGS_KEYS.farmLatLon);
  if (!raw) return LOUDOUN_DEFAULT_LAT_LON;
  try {
    const v = JSON.parse(raw) as { lat?: unknown; lon?: unknown };
    if (typeof v.lat === 'number' && typeof v.lon === 'number') return { lat: v.lat, lon: v.lon };
  } catch {
    /* fall through */
  }
  return LOUDOUN_DEFAULT_LAT_LON;
}

export function getAiMonthlyUsdCap(): number {
  const raw = getSetting(SETTINGS_KEYS.aiMonthlyUsdCap);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_AI_MONTHLY_USD_CAP;
}

export function getAiDailyCallQuota(): typeof DEFAULT_AI_DAILY_QUOTA {
  const raw = getSetting(SETTINGS_KEYS.aiDailyCallQuota);
  if (!raw) return DEFAULT_AI_DAILY_QUOTA;
  try {
    const v = JSON.parse(raw) as Partial<typeof DEFAULT_AI_DAILY_QUOTA>;
    // Merge per-key so any owner overrides apply on top of the canonical
    // defaults. Iterating Object.keys keeps us in sync as new quota
    // endpoints land — no need to hand-extend this list every time
    // (rationale, plugin-scan, plugin-search, plugin-batch-scan, …).
    const out = { ...DEFAULT_AI_DAILY_QUOTA };
    for (const key of Object.keys(out) as Array<keyof typeof DEFAULT_AI_DAILY_QUOTA>) {
      const override = v[key];
      if (typeof override === 'number') {
        (out as Record<string, number>)[key] = override;
      }
    }
    return out;
  } catch {
    return DEFAULT_AI_DAILY_QUOTA;
  }
}
