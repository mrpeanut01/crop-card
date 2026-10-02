/**
 * Every USDA organic (7 CFR part 205) rule the app reads, in one place
 * (33B ruling B-02). A rule is switched on only with a verified quote in
 * `apps/web/scripts/nop-sources.json`; the gate in
 * `nopRules.sources.gate.test.ts` fails otherwise. Code reads only this
 * object, never the JSON, so while a value is null or false the app shows
 * facts and "Ask your certifier." (B-04).
 */

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

export const ASK_YOUR_CERTIFIER = 'Ask your certifier.';

/** B-06: the welfare line on every treatment screen for an organic animal. */
export function withholdTreatmentLine(rules: Readonly<NopRules> = NOP_RULES): string {
  if (rules.withholdTreatmentCitation) {
    return `Treat a sick animal. The organic rules forbid withholding treatment to keep status (${rules.withholdTreatmentCitation}).`;
  }
  return 'Treat a sick animal first. Ask your certifier how a treatment affects organic status.';
}
