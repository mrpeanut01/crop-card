/**
 * Form parsing for the farm location + frost dates. Shared by /settings/farm
 * and the /onboarding location step so both write the same app_settings
 * shapes (`farm_lat_lon` JSON, `MM-DD` frost strings).
 */

import type { FarmLatLon } from './constants';

const MM_DD_RE = /^(0?[1-9]|1[0-2])-(0?[1-9]|[12][0-9]|3[01])$/;

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

/** Normalize a frost-date form value to `MM-DD`, or null when blank or
 *  invalid. Accepts `<input type="date">` (`YYYY-MM-DD`) and bare `MM-DD`. */
export function normalizeFrost(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const iso = /^\d{4}-(\d{2})-(\d{2})$/.exec(s);
  const mmdd = iso ? `${iso[1]}-${iso[2]}` : s;
  return MM_DD_RE.test(mmdd) ? mmdd : null;
}
