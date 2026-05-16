/**
 * Pure constants and types. Safe to import in browser code. DB-reading
 * helpers (`frostDatesForYear`, `getFarmLatLon`, AI quotas) live in
 * `./settings.ts` so this module stays free of `better-sqlite3`.
 */

export type TillageMethod = 'conventional' | 'reduced-till' | 'no-till';

export const DAY_MS = 86_400_000;

export const LOUDOUN_DEFAULT_LAST_FROST_MMDD = '04-15';
export const LOUDOUN_DEFAULT_FIRST_FROST_MMDD = '10-15';

/** App-settings keys (Phase 14) used by the Plan-Schedule swim-lane. */
export const SETTINGS_KEYS = {
  lastFrost: 'last_frost_date',
  firstFrost: 'first_frost_date',
  farmLatLon: 'farm_lat_lon',
  aiMonthlyUsdCap: 'ai_monthly_usd_cap',
  aiDailyCallQuota: 'ai_daily_call_quota',
  /** Display: show shade-window markers on Plan→Schedule. Default true. */
  showShadeMarkers: 'show_shade_markers',
  /** Display: show the Reorder-level checkbox + threshold field on the
   *  inventory edit modal. Default off — most operators rely on visual
   *  inspection rather than per-item thresholds. */
  displayReorderLevel: 'display_reorder_level',
  /** Display: show the Planter setup subsection (plate + seed dims) on
   *  the inventory edit modal for seed items. Default on. */
  displayPlanterSetup: 'display_planter_setup'
} as const;

export const DEFAULT_SHOW_SHADE_MARKERS = true;
export const DEFAULT_DISPLAY_REORDER_LEVEL = false;
export const DEFAULT_DISPLAY_PLANTER_SETUP = true;

export function parseBoolSetting(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return fallback;
}

export function parseMmDd(s: string | undefined): { month: number; day: number } | null {
  if (!s) return null;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month: month - 1, day };
}

export interface FarmLatLon {
  lat: number;
  lon: number;
}

export const LOUDOUN_DEFAULT_LAT_LON: FarmLatLon = { lat: 39.09, lon: -77.6 };

export const DEFAULT_AI_MONTHLY_USD_CAP = 5.0;
export const DEFAULT_AI_DAILY_QUOTA = {
  suggest: 20,
  succession: 20,
  optimize: 2,
  allocate: 5,
  groups: 5,
  shortNames: 5
} as const;

export type AiEndpointName = keyof typeof DEFAULT_AI_DAILY_QUOTA;
