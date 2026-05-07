import type { CropStage, HerbicideProduct, SafetyViolation } from './types';

/**
 * Crop-stage gates. Today only the canonical 2,4-D over corn > 8" rule
 * lives here, but new gates plug in by adding to this list. Each gate is
 * a pure predicate over (product, crop) yielding 0..1 violation.
 *
 * Gates key off `cropFamily` rather than `cropPluginId` so they apply across
 * every variety of a family (e.g., all dent + sweet corn cultivars). Callers
 * that don't supply cropFamily for back-compat fall through; identifying corn
 * by pluginId stem ('corn' or 'corn-…') is a defensive secondary check.
 */
type Gate = (product: HerbicideProduct, crop: CropStage) => SafetyViolation | null;

function isCorn(crop: CropStage): boolean {
  if (crop.cropFamily === 'corn') return true;
  if (!crop.cropFamily && (crop.cropPluginId === 'corn' || crop.cropPluginId.startsWith('corn-'))) {
    return true;
  }
  return false;
}

const GATES: Gate[] = [
  (product, crop) => {
    if (!isCorn(crop)) return null;
    const hasAuxin = product.activeIngredients.some(
      (ai) => ai.chemistryClass === 'synthetic-auxin'
    );
    if (!hasAuxin) return null;
    if ((crop.heightInches ?? 0) <= 8) return null;
    return {
      code: 'CROP_STAGE_BLOCK',
      message: 'Synthetic-auxin (e.g. 2,4-D) is blocked over corn taller than 8 inches',
      detail: {
        product: product.pluginId,
        cropPluginId: crop.cropPluginId,
        cropFamily: crop.cropFamily,
        heightInches: crop.heightInches
      }
    };
  }
];

export function checkCropStage(products: HerbicideProduct[], crop: CropStage): SafetyViolation[] {
  const violations: SafetyViolation[] = [];
  for (const product of products) {
    for (const gate of GATES) {
      const v = gate(product, crop);
      if (v) violations.push(v);
    }
  }
  return violations;
}
