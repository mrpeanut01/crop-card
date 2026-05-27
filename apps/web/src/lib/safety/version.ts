/**
 * Bump on any change to safety-kernel rules. Persisted on every spray record
 * so rule updates cannot retroactively misvalidate prior decisions.
 *
 * Sprint 12 (#194) — 0.5.1: added fungicideTankMix evaluator for
 * pair-specific phytotoxicity (copper × sulfur, FRAC M01 × M02).
 */
export const RULES_VERSION = '0.5.1-sprint12' as const;
