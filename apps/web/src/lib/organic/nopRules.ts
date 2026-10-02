/**
 * Every USDA organic (7 CFR part 205) rule the app reads, in one place
 * (33B ruling B-02). A rule is switched on only with a verified quote in
 * `apps/web/scripts/nop-sources.json`; the gate in
 * `nopRules.sources.gate.test.ts` fails otherwise. Code reads only this
 * object, never the JSON, so while a value is null or false the app shows
 * facts and "Ask your certifier." (B-04). All four are on since
 * 2026-10-02, from the eCFR text up to date as of 2026-09-29.
 */

import { t } from '$lib/i18n';

export interface NopRules {
  /** Months with no prohibited substance before land can qualify. */
  landTransitionMonths: number | null;
  /** Antibiotics and not-allowed substances end an animal's status. */
  treatedAnimalRule: boolean;
  /** Citation for "do not withhold treatment to keep status". */
  withholdTreatmentCitation: string | null;
  /** Citation for the organic seed sourcing rule. */
  seedSourcingCitation: string | null;
}

export const NOP_RULES: Readonly<NopRules> = Object.freeze({
  landTransitionMonths: 36,
  treatedAnimalRule: true,
  withholdTreatmentCitation: '7 CFR 205.238(c)(7)',
  seedSourcingCitation: '7 CFR 205.204(a)'
});

/** Every rule switched off, for callers and tests of the B-04 path. */
export const NOP_RULES_OFF: Readonly<NopRules> = Object.freeze({
  landTransitionMonths: null,
  treatedAnimalRule: false,
  withholdTreatmentCitation: null,
  seedSourcingCitation: null
});

/** The `nop-sources.json` entry key behind each rule (research Task R1). */
export const NOP_RULE_SOURCE_KEYS: Readonly<Record<keyof NopRules, string>> = Object.freeze({
  landTransitionMonths: 'landTransition',
  treatedAnimalRule: 'treatedAnimal',
  withholdTreatmentCitation: 'withholdTreatment',
  seedSourcingCitation: 'seedSourcing'
});

/** The paragraphs the land and treated-animal lines name. Shown only
 *  while their rule is on; the gate checks each against its entry. */
export const LAND_TRANSITION_CITATION = '7 CFR 205.202(b)';
export const TREATED_ANIMAL_CITATION = '7 CFR 205.238(c)(1)';

export const ASK_YOUR_CERTIFIER = 'Ask your certifier.';

/** B-06: the welfare line on every treatment screen for an organic animal. */
export function withholdTreatmentLine(
  rules: Readonly<NopRules> = NOP_RULES,
  locale?: string | null
): string {
  if (rules.withholdTreatmentCitation) {
    return t(locale, 'organic.welfare.cited', { citation: rules.withholdTreatmentCitation });
  }
  return t(locale, 'organic.welfare.ask');
}

/** O-14: the app reports seed searches and never judges them. */
export function seedSourcingLine(
  rules: Readonly<NopRules> = NOP_RULES,
  locale?: string | null
): string {
  if (rules.seedSourcingCitation) {
    return t(locale, 'organic.seed.ruleCited', { citation: rules.seedSourcingCitation });
  }
  return t(locale, 'organic.seed.ruleAsk');
}
