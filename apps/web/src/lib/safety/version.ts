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
 * #323 #340 — 0.5.4: FR-21 bale-gate `danger`-severity moisture violations
 * (>22% fire risk / UC-14) are now NON-overridable — `overrideBaleGate`
 * only clears `warn` severity. Harvest-moisture (#340) block/warn copy
 * branches on the cure archetype so winter-squash no longer reads the
 * small-grain "drying required" remedy.
 * #350 (UC-45) — 0.5.5: class-specific decon SOPs (`deconProtocol.ts`).
 * The winterization flow (and any decon) selects a bespoke rinse sequence
 * for the three strict chemistries — paraquat (bleach + TSP + 3 rinses),
 * glufosinate (detergent + water rinse), copper (vinegar rinse) — instead
 * of the generic ammonia soak. Every other class keeps the generic path.
 * #130 — 0.5.6: pollinator-protection gate (`pollinatorProtection.ts`).
 * Insecticide records are blocked when the label prohibits application
 * during bloom and the block is in bloom (or bloom is unattested), and
 * dusk-to-dawn-only products are blocked between sunrise and sunset while
 * flowers may be present (NOAA sunrise/sunset in `sunTimes.ts`).
 * 0.5.7: harvestMoisture no longer gates the `winter-squash-cure`
 * archetype. Its 70% ceiling sat below the 80 to 90% flesh moisture of
 * healthy squash, potatoes and root crops, so an honest reading was
 * refused. Cure-then-store moisture is now recorded, never blocked.
 * Phase 32C — 0.6.0: the animal withdrawal rule (`animalWithdrawal.ts`,
 * `prohibitedAnimalDrugs.ts`) and the grazing and haying interval rule
 * (`grazingInterval.ts`, with `grazingExposure.ts` holding food from
 * animals that were on a sprayed Area inside its interval).
 * Phase 32C ruling C-35 — 0.7.0: holds never shorten (`holdLedger.ts`).
 * Every write that can affect a withdrawal, grazing, hay or exposure hold
 * runs through one guard (`lib/server/holdGuard.ts`) that projects the
 * farm's holds before and after the write and refuses it when any held
 * moment or covered record would go (`HOLD_WOULD_SHORTEN`); declarations
 * and terminal events are dated in order, and hold parameters are
 * snapshotted so later data can only lengthen a hold.
 * Issue #469 — 0.7.1: the prohibited-drug table was checked against 21 CFR
 * 530.41 (eCFR, 2026-09-28). The influenza A paragraphs are (d)(1) and
 * (d)(2), not (b)(1) and (b)(2); no drug was added or removed.
 * #530 — 0.7.2: the fungicide bloom gate (`checkPollinatorBloom`) also reads
 * the plugin's label `pollinator` block and gates on the riskier of it and
 * the legacy `pollinatorRisk` hint (`effectivePollinatorRisk`). Label data
 * can only add a block; shipped fungicides keep the verdicts they had.
 */
export const RULES_VERSION = '0.7.2' as const;
