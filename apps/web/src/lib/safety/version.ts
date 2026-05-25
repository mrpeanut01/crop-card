/**
 * Bump on any change to safety-kernel rules. Persisted on every spray record
 * so rule updates cannot retroactively misvalidate prior decisions.
 *
 * Phase 25d (#89) — bumped to 0.5.0 for the three new evaluators
 * (fracRotation, ipmThreshold, pollinatorBloom). Verdicts run in
 * dry-run mode (KERNEL_DRY_RUN=1) until the 14-day false-positive
 * window per #87 step 6 closes; logs accumulate in `kernel_dry_run_log`
 * for review before gates go live.
 */
export const RULES_VERSION = '0.5.0-phase25d' as const;
