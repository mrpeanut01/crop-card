/**
 * Bump on any change to safety-kernel rules. Persisted on every spray record
 * so rule updates cannot retroactively misvalidate prior decisions.
 *
 * Sprint 12 (#194) — 0.5.1: added fungicideTankMix evaluator for
 * pair-specific phytotoxicity (copper × sulfur, FRAC M01 × M02).
 * Sprint 19 (#132 Phase 26A · UC-16) — 0.5.2: added harvestMoisture
 * evaluator. Stored-moisture above family threshold blocks the harvest
 * commit (small-grain 13.5%, dry legume 15%, forage 18%, cure 70%).
 * #321 — 0.5.3: cross-contamination gate now reasons over the widened
 * `SprayerLoadClass` (adds `insecticide-load` / `fungicide-load`). The
 * insecticide + fungicide record endpoints run the gate before persist and
 * update `lastChemistryClass` after, so herbicide-after-insecticide (and
 * other cross-category) sequences correctly require decon.
 */
export const RULES_VERSION = '0.5.3-issue321' as const;
