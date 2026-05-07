/**
 * Crop-family compatibility gate (FR-03).
 *
 * For each product × crop pair in the block, refuse if the product's chemistry
 * class kills the crop's family. This is the rule that prevents 2,4-D being
 * sprayed on a block that contains pumpkins, beans, or any broadleaf companion
 * — even if a plugin claimed otherwise.
 *
 * The kill matrix is hardcoded in cropFamilyLethality.ts and cannot be
 * overridden by any plugin file.
 */

import { killsFamily, type CropFamily } from './cropFamilyLethality';
import type { ChemistryClass, CropStage, HerbicideProduct, SafetyViolation } from './types';

export function checkCropCompatibility(
  products: HerbicideProduct[],
  primary: CropStage,
  coPlanted: ReadonlyArray<CropStage> = []
): SafetyViolation[] {
  const violations: SafetyViolation[] = [];
  const allCrops = [primary, ...coPlanted];

  for (const product of products) {
    for (const crop of allCrops) {
      if (!crop.cropFamily) continue;
      const killing = uniqueClasses(product).filter((cls) =>
        killsFamily(cls, crop.cropFamily as CropFamily)
      );
      for (const cls of killing) {
        violations.push({
          code: 'CROP_INCOMPATIBLE',
          message: `${product.pluginId} (${cls}) is lethal to ${crop.cropFamily} crops`,
          detail: {
            product: product.pluginId,
            chemistryClass: cls,
            cropPluginId: crop.cropPluginId,
            cropFamily: crop.cropFamily,
            isCoPlanted: crop !== primary
          }
        });
      }
    }
  }
  return violations;
}

function uniqueClasses(product: HerbicideProduct): ChemistryClass[] {
  return Array.from(new Set(product.activeIngredients.map((ai) => ai.chemistryClass)));
}
