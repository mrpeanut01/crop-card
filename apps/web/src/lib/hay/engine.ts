/**
 * Hay/forage operations kernel.
 *
 * Two gates the UI must clear before letting the operator advance the
 * cutting state machine:
 *
 *   - `evaluateMowDecision()` (FR-22) — returns ok=true if the next
 *     `weatherWindowDays` days are mostly dry, else returns the rain-risk
 *     days as a violation. The operator is allowed to override (it's a
 *     judgment call), but the override is logged on the cutting record.
 *
 *   - `evaluateBaleDecision()` (FR-21) — applies the plugin's
 *     `baleMoistureGate` thresholds. >dangerAbovePct → STOP (fire-risk);
 *     >warnAbovePct → soft warn; <warn/dangerBelowPct → leaf-shatter
 *     warning. Plugins declare values; the kernel enforces.
 *
 * The state machine sequencing (`canAdvance`, `nextStep`) is a thin
 * helper that keeps the UI from skipping steps the plugin's `steps[]`
 * declared.
 *
 * Shared between client + server so an offline operator gets the same
 * answer the server will compute on persist.
 */

import type {
  BaleDecision,
  BaleDecisionInput,
  HayStatus,
  HayStep,
  HayViolation,
  MowDecision,
  MowDecisionInput
} from './types';

const DEFAULT_RAIN_RISK_PCT = 30;

export function evaluateMowDecision(input: MowDecisionInput): MowDecision {
  const window = input.spec.weatherWindowDays;
  const rainRisk = input.rainRiskPct ?? DEFAULT_RAIN_RISK_PCT;
  const violations: HayViolation[] = [];
  const warnings: HayViolation[] = [];

  if (input.forecast.length < window) {
    violations.push({
      code: 'WEATHER_INSUFFICIENT_FORECAST',
      severity: 'danger',
      message: `plugin requires ${window}-day window, only ${input.forecast.length} day(s) of forecast available`,
      detail: { required: window, have: input.forecast.length }
    });
    return { ok: false, violations, warnings };
  }

  const window_days = input.forecast.slice(0, window);
  const wetDays = window_days.filter((d) => d.popPct > rainRisk);
  if (wetDays.length > 0) {
    violations.push({
      code: 'WEATHER_RAIN_RISK',
      severity: 'danger',
      message: `${wetDays.length} of next ${window} day(s) have rain probability >${rainRisk}%`,
      detail: {
        threshold: rainRisk,
        wetDays: wetDays.map((d) => ({ date: d.date, popPct: d.popPct }))
      }
    });
  }

  // Soft warning: cool nights extend dry-down. <50°F low across the window
  // means hay won't dry to bale moisture by day-3 typical alfalfa schedule.
  const coolNights = window_days.filter((d) => d.lowF < 50);
  if (coolNights.length >= 2) {
    warnings.push({
      code: 'WEATHER_RAIN_RISK',
      severity: 'warn',
      message: `${coolNights.length} cool night(s) (<50 °F) — drying may stretch beyond the ${window}-day window`,
      detail: { coolNights: coolNights.map((d) => ({ date: d.date, lowF: d.lowF })) }
    });
  }

  if (violations.length > 0) return { ok: false, violations, warnings };
  return { ok: true, daysCovered: window, warnings };
}

export function evaluateBaleDecision(input: BaleDecisionInput): BaleDecision {
  const violations: HayViolation[] = [];
  const warnings: HayViolation[] = [];

  if (input.moisturePct === null || input.moisturePct === undefined) {
    violations.push({
      code: 'MOISTURE_MISSING',
      severity: 'danger',
      message: 'moisture reading is required before baling'
    });
    return { ok: false, violations, warnings };
  }

  if (!input.baleType) {
    violations.push({
      code: 'BALE_TYPE_MISSING',
      severity: 'danger',
      message: 'bale type is required before baling'
    });
    return { ok: false, violations, warnings };
  }

  const gate = input.spec.baleMoistureGate?.[input.baleType];
  if (!gate) {
    // Plugin doesn't gate this bale type — treat as soft warn so the
    // operator at least sees the unknown-policy state.
    warnings.push({
      code: 'BALE_TYPE_NOT_GATED',
      severity: 'warn',
      message: `plugin declares no baleMoistureGate for ${input.baleType}; check the label by hand`
    });
    return { ok: true, warnings };
  }

  const m = input.moisturePct;
  if (gate.dangerAbovePct !== undefined && m > gate.dangerAbovePct) {
    violations.push({
      code: 'MOISTURE_TOO_HIGH',
      severity: 'danger',
      message: `moisture ${m}% exceeds danger threshold ${gate.dangerAbovePct}% — fire risk in storage`,
      detail: { moisturePct: m, dangerAbovePct: gate.dangerAbovePct, baleType: input.baleType }
    });
  } else if (gate.warnAbovePct !== undefined && m > gate.warnAbovePct) {
    warnings.push({
      code: 'MOISTURE_TOO_HIGH',
      severity: 'warn',
      message: `moisture ${m}% above warn threshold ${gate.warnAbovePct}% — heating risk`,
      detail: { moisturePct: m, warnAbovePct: gate.warnAbovePct, baleType: input.baleType }
    });
  }

  if (gate.dangerBelowPct !== undefined && m < gate.dangerBelowPct) {
    violations.push({
      code: 'MOISTURE_TOO_LOW',
      severity: 'danger',
      message: `moisture ${m}% below danger threshold ${gate.dangerBelowPct}% — leaf shatter / yield loss`,
      detail: { moisturePct: m, dangerBelowPct: gate.dangerBelowPct, baleType: input.baleType }
    });
  } else if (gate.warnBelowPct !== undefined && m < gate.warnBelowPct) {
    warnings.push({
      code: 'MOISTURE_TOO_LOW',
      severity: 'warn',
      message: `moisture ${m}% below warn threshold ${gate.warnBelowPct}% — quality risk`,
      detail: { moisturePct: m, warnBelowPct: gate.warnBelowPct, baleType: input.baleType }
    });
  }

  if (violations.length > 0) return { ok: false, violations, warnings };
  return { ok: true, warnings };
}

// ─── State-machine helpers ──────────────────────────────────────────────

/**
 * Status semantics: each "X-ing" status means "step X just completed, the
 * cutting is now in the post-X phase." So `mowing` = mow done, drying
 * underway; `complete` = store done. The `store` step transitions
 * directly to `complete` (the `storing` enum value is reserved for a
 * future "stored, awaiting cure" phase but isn't produced by the engine).
 */
const STATUS_FOR_STEP: Record<HayStep, HayStatus> = {
  mow: 'mowing',
  ted: 'tedding',
  rake: 'raking',
  bale: 'baling',
  store: 'complete'
};

const COMPLETED_AT_STATUS: Record<HayStatus, HayStep | null> = {
  mowing: 'mow',
  tedding: 'ted',
  raking: 'rake',
  baling: 'bale',
  storing: 'store',
  complete: 'store',
  aborted: null
};

/**
 * Compute the next step in the plugin's declared `steps[]`. Skipping a
 * step (some hay protocols omit `ted`) is allowed — the engine just hops
 * to whatever the plugin declared next.
 */
export function nextStep(steps: readonly HayStep[], currentStatus: HayStatus): HayStep | null {
  if (currentStatus === 'complete' || currentStatus === 'aborted') return null;
  const lastDone = COMPLETED_AT_STATUS[currentStatus];
  const idx = lastDone === null ? -1 : steps.indexOf(lastDone);
  return steps[idx + 1] ?? null;
}

export function statusAfter(step: HayStep): HayStatus {
  return STATUS_FOR_STEP[step];
}

export function canAdvance(
  steps: readonly HayStep[],
  currentStatus: HayStatus,
  attemptedStep: HayStep
): boolean {
  const next = nextStep(steps, currentStatus);
  return next === attemptedStep;
}

export function isTerminal(status: HayStatus): boolean {
  return status === 'complete' || status === 'aborted';
}
