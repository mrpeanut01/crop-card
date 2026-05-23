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
  shortNames: 5,
  /** Phase 21 / B-27 — AI substitution + tank-mix consolidation on top
   *  of the deterministic InputsPlan. Capped low because each refinement
   *  is a non-trivial call; the deterministic baseline always works
   *  when the quota's spent. */
  inputs: 10,
  /** Stock metadata refresh — enriches a stock-item row from product
   *  label + web sources (chemistry / FRAC / IRAC / NPK / planter-plate
   *  spec). Per-item one-shot; the user triggers manually via the
   *  Refresh AI button on Stock. */
  rationale: 20,
  /** Phase 22 / PR3 — Plugin Manager label scan. One AI call per photo;
   *  produces a single plugin candidate that the operator confirms before
   *  commit. */
  'plugin-scan': 10,
  /** Phase 22 / PR3 — Plugin Manager name search. Types a partial product
   *  name and gets ≤3 ranked candidates via web_search. Local fuzzy
   *  matches against the live registry do NOT consume quota. */
  'plugin-search': 15,
  /** Phase 22 / PR4 — Plugin Manager receipt / manifest scan. ONE quota
   *  call per receipt regardless of how many line items it contains. The
   *  per-line enrichment that follows uses the existing 'plugin-search'
   *  quota since each line item triggers a web_search to fill the plugin
   *  shape. Cap intentionally low — a receipt is a high-leverage import. */
  'plugin-batch-scan': 5
} as const;

export type AiEndpointName = keyof typeof DEFAULT_AI_DAILY_QUOTA;
