/**
 * Form parsing for the farm location + frost dates. Shared by /settings/farm
 * and the /onboarding location step so both write the same app_settings
 * shapes (`farm_lat_lon` JSON, `MM-DD` frost strings).
 */

import type { FarmLatLon } from './constants';

/** Both coordinates present, finite and in range, or null. */
export function parseLatLon(latRaw: unknown, lonRaw: unknown): FarmLatLon | null {
  const latS = String(latRaw ?? '').trim();
  const lonS = String(lonRaw ?? '').trim();
  if (!latS || !lonS) return null;
  const lat = Number(latS);
  const lon = Number(lonS);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Normalize a frost-date form value to zero-padded `MM-DD`, or null when
 *  blank or invalid. Accepts `<input type="date">` (`YYYY-MM-DD`), `MM-DD`
 *  and US-style `M/D`. Feb 29 is allowed since frost dates carry no year. */
export function normalizeFrost(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(s) ?? /^(\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > DAYS_IN_MONTH[month - 1]) return null;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
