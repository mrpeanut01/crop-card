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
 *
 * Phase 11 trait override: when a herbicide declares `requiresTraits` and
 * the crop's `traits[]` includes every listed trait, the kill-matrix check
 * is skipped for that (product, crop) pair. The trait is precisely what
 * makes the matrix-default unsafe call wrong for this cultivar — e.g.,
 * dicamba (synthetic-auxin → kills legumes) on Xtend-traited soybean.
 * Without `requiresTraits`, the gate behaves exactly as before.
 *
 * Issue #53 (half 1): emits ONE violation per (product, chemistryClass)
 * instead of one per (product, crop). The detail carries `crops[]` so the
 * UI can render a single STOP card listing every affected crop.
 * Pre/post-emergent awareness is half 2 and not in this pass.
 */

import { killsFamily, type CropFamily } from './cropFamilyLethality';
import type {
  ChemistryClass,
  CropIncompatibilityCrop,
  CropStage,
  HerbicideProduct,
  SafetyViolation
} from './types';

function traitOverrideActive(product: HerbicideProduct, crop: CropStage): boolean {
  const claim = product.traitGatedSafeFor?.find((c) => c.cropPluginId === crop.cropPluginId);
  if (!claim || claim.requiresTraits.length === 0) return false;
  const have = new Set(crop.traits ?? []);
  return claim.requiresTraits.every((t) => have.has(t));
}

export function checkCropCompatibility(
  products: HerbicideProduct[],
  primary: CropStage,
  coPlanted: ReadonlyArray<CropStage> = []
): SafetyViolation[] {
  const violations: SafetyViolation[] = [];
  const allCrops = [primary, ...coPlanted];

  for (const product of products) {
    const grouped = new Map<ChemistryClass, CropIncompatibilityCrop[]>();

    for (const crop of allCrops) {
      if (!crop.cropFamily) continue;
      if (traitOverrideActive(product, crop)) continue;

      const killing = uniqueClasses(product).filter((cls) =>
        killsFamily(cls, crop.cropFamily as CropFamily)
      );
      for (const cls of killing) {
        const list = grouped.get(cls) ?? [];
        list.push({
          cropPluginId: crop.cropPluginId,
          cropFamily: crop.cropFamily as CropFamily,
          isCoPlanted: crop !== primary
        });
        grouped.set(cls, list);
      }
    }

    for (const [cls, crops] of grouped) {
      const families = uniqueFamilies(crops);
      violations.push({
        code: 'CROP_INCOMPATIBLE',
        message: `${product.pluginId} (${cls}) is lethal to ${families.join(', ')} crops`,
        detail: {
          product: product.pluginId,
          chemistryClass: cls,
          crops
        }
      });
    }
  }
  return violations;
}

function uniqueClasses(product: HerbicideProduct): ChemistryClass[] {
  return Array.from(new Set(product.activeIngredients.map((ai) => ai.chemistryClass)));
}

function uniqueFamilies(crops: ReadonlyArray<CropIncompatibilityCrop>): CropFamily[] {
  return Array.from(new Set(crops.map((c) => c.cropFamily))).sort();
}
