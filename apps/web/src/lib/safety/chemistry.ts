import type { ChemistryClass, HerbicideProduct, SafetyViolation } from './types';

/**
 * Pairwise prohibitions between chemistry classes when co-applied (tank mix
 * OR same-pass sequential). Encoded as an unordered set; order-insensitive
 * by construction (sorted before lookup). Adding a pair here is a kernel
 * change and requires a RULES_VERSION bump.
 */
const INCOMPATIBLE_PAIRS: ReadonlySet<string> = new Set([
  // Legacy v1 pairs
  pairKey('synthetic-auxin', 'chloroacetamide'),
  pairKey('synthetic-auxin', 'hppd-inhibitor'),
  pairKey('accase-inhibitor', 'sulfonylurea'),
  pairKey('accase-inhibitor', 'glyphosate'),
  // Phase 9 — label-prohibited or known-antagonistic tank mixes
  pairKey('glufosinate', 'glyphosate'),           // antagonism — cannot tank-mix
  pairKey('glufosinate', 'synthetic-auxin'),      // label-prohibited per Bayer Liberty 280 SL
  pairKey('clomazone', 'glyphosate'),             // formulation incompatibility on most labels
  pairKey('ppo-inhibitor', 'als-imidazolinone'),  // crop-injury risk (soybean / dry bean)
  pairKey('accase-inhibitor', 'photosystem-ii-triazine'), // atrazine antagonism on grass control
  pairKey('accase-inhibitor', 'glufosinate')      // antagonism — Liberty disrupts grass uptake
]);

function pairKey(a: ChemistryClass, b: ChemistryClass): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function isIncompatiblePair(a: ChemistryClass, b: ChemistryClass): boolean {
  if (a === b) return false;
  return INCOMPATIBLE_PAIRS.has(pairKey(a, b));
}

export function checkChemistryCompatibility(products: HerbicideProduct[]): SafetyViolation[] {
  const violations: SafetyViolation[] = [];
  const classes = products.flatMap((p) =>
    p.activeIngredients.map((ai) => ({ pluginId: p.pluginId, cls: ai.chemistryClass }))
  );

  for (let i = 0; i < classes.length; i++) {
    for (let j = i + 1; j < classes.length; j++) {
      const a = classes[i];
      const b = classes[j];
      if (a.pluginId === b.pluginId) continue;
      if (isIncompatiblePair(a.cls, b.cls)) {
        violations.push({
          code: 'CHEMISTRY_INCOMPATIBLE',
          message: `${a.cls} and ${b.cls} cannot be co-applied`,
          detail: { products: [a.pluginId, b.pluginId], classes: [a.cls, b.cls] }
        });
      }
    }
  }
  return violations;
}
