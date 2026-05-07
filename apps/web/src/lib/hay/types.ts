/**
 * Sprint E — hay/forage operations engine types.
 *
 * Mirrors the spec FRs:
 *   FR-19  multi-step hay workflow (mow → ted → rake → bale → store)
 *   FR-21  harvest-moisture gates (>22% baled hay = fire risk by default)
 *   FR-22  cutting-window forecast — drives the "go / no-go" mow decision
 *   FR-23  storage temperature watch (post-bale calendar reminder)
 *
 * The engine is shared between client and server (same TS file imported
 * in both bundles) so a hay decision can be evaluated offline in the
 * field and re-validated server-side on persist.
 */

export type HayStep = 'mow' | 'ted' | 'rake' | 'bale' | 'store';

export type HayStatus =
  | 'mowing'
  | 'tedding'
  | 'raking'
  | 'baling'
  | 'storing'
  | 'complete'
  | 'aborted';

export type BaleType = 'small-square' | 'large-round' | 'large-square';

export interface MoistureThresholds {
  warnBelowPct?: number;
  dangerBelowPct?: number;
  warnAbovePct?: number;
  dangerAbovePct?: number;
  optimumPercent?: { min: number; max: number };
}

export type BaleMoistureGate = Partial<Record<BaleType, MoistureThresholds>>;

export interface HayOperationsSpec {
  steps: HayStep[];
  cuttingsPerSeason?: { min: number; max: number };
  cutIntervalDays?: { min: number; max: number };
  mowTrigger?: string;
  weatherWindowDays: number;
  baleMoistureGate?: BaleMoistureGate;
  storageTempWatchF?: { warn: number; danger: number };
}

/** Single-day forecast slice consumed by the mow decision. */
export interface ForecastDay {
  /** ISO date string (YYYY-MM-DD) for the forecast day. */
  date: string;
  /** Probability of precipitation %, 0–100. */
  popPct: number;
  /** Daily temperature high (°F). */
  highF: number;
  /** Daily temperature low (°F). */
  lowF: number;
  /** Mean wind speed (mph). */
  windMph?: number;
  /** Free-form short forecast string from NWS (e.g., "Mostly sunny"). */
  shortForecast?: string;
}

export type HayViolationCode =
  | 'WEATHER_RAIN_RISK'
  | 'WEATHER_INSUFFICIENT_FORECAST'
  | 'WEATHER_FORECAST_STALE'
  | 'MOISTURE_TOO_HIGH'
  | 'MOISTURE_TOO_LOW'
  | 'MOISTURE_MISSING'
  | 'BALE_TYPE_MISSING'
  | 'BALE_TYPE_NOT_GATED'
  | 'STEP_OUT_OF_ORDER';

export interface HayViolation {
  code: HayViolationCode;
  message: string;
  detail?: Record<string, unknown>;
  /** Hard STOP vs. soft warning. UI renders red vs. amber accordingly. */
  severity: 'danger' | 'warn';
}

export interface MowDecisionInput {
  spec: HayOperationsSpec;
  forecast: ForecastDay[];
  /** Threshold above which a day counts as "rain risk". Plugins can't widen
   *  this — the kernel pins it at 30% to match FR-06's spray rain threshold. */
  rainRiskPct?: number;
}

export type MowDecision =
  | { ok: true; daysCovered: number; warnings: HayViolation[] }
  | { ok: false; violations: HayViolation[]; warnings: HayViolation[] };

export interface BaleDecisionInput {
  spec: HayOperationsSpec;
  baleType: BaleType;
  /** Recorded moisture as a real percent (e.g., 17.5 = 17.5%). */
  moisturePct: number | null | undefined;
}

export type BaleDecision =
  | { ok: true; warnings: HayViolation[] }
  | { ok: false; violations: HayViolation[]; warnings: HayViolation[] };
