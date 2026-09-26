/**
 * Server-only settings reads. Split from `./constants` so client bundles
 * don't pull in `$lib/db/settings` (and the `better-sqlite3` chain behind it).
 *
 * Anything that calls `getSetting()` lives here.
 */

import { getSetting } from '$lib/db/settings';
import {
  DEFAULT_AI_DAILY_QUOTA,
  LOUDOUN_DEFAULT_FIRST_FROST_MMDD,
  LOUDOUN_DEFAULT_LAST_FROST_MMDD,
  LOUDOUN_DEFAULT_LAT_LON,
  parseMmDd,
  SETTINGS_KEYS,
  type AiEndpointName,
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
    parseMmDd(getSetting(SETTINGS_KEYS.firstFrost)) ?? parseMmDd(LOUDOUN_DEFAULT_FIRST_FROST_MMDD)!;
  return {
    lastSpringFrostMs: new Date(year, last.month, last.day).getTime(),
    firstFallFrostMs: new Date(year, first.month, first.day).getTime()
  };
}

/** Frost dates as local calendar days, for code shared with the browser. */
export function frostDatesIsoForYear(year: number): { lastSpring: string; firstFall: string } {
  const { lastSpringFrostMs, firstFallFrostMs } = frostDatesForYear(year);
  return { lastSpring: toLocalDay(lastSpringFrostMs), firstFall: toLocalDay(firstFallFrostMs) };
}

function toLocalDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

/** The owner's own monthly AI cap, or null when they have not set one.
 *  The plan budget is the ceiling; this can only lower it. */
export function getAiMonthlyUsdCapSetting(): number | null {
  const raw = getSetting(SETTINGS_KEYS.aiMonthlyUsdCap);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Per-feature daily limits the owner lowered below the plan's. */
export function getAiDailyCallQuotaOverrides(): Partial<Record<AiEndpointName, number>> {
  const raw = getSetting(SETTINGS_KEYS.aiDailyCallQuota);
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<Record<AiEndpointName, number>> = {};
    for (const key of Object.keys(DEFAULT_AI_DAILY_QUOTA) as AiEndpointName[]) {
      const n = v[key];
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[key] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/** True once the owner has saved real coordinates (not the Loudoun default). */
export function hasFarmLatLon(): boolean {
  const raw = getSetting(SETTINGS_KEYS.farmLatLon);
  if (!raw) return false;
  return getFarmLatLon() !== LOUDOUN_DEFAULT_LAT_LON;
}
