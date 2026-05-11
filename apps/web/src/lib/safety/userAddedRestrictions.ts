/**
 * Phase 17 (Track 2.3) — Data-augmented safety hook.
 *
 * Per CLAUDE.md invariant #1, the safety kernel
 * (`cropFamilyLethality`, `cropStage`, …) is hard-coded. This module wraps a
 * kernel result and **adds** restrictions sourced from user-added stock
 * (`stockItems.activeIngredientsJson`) and plugin metadata. It NEVER weakens
 * a kernel verdict — every restriction here can only push `ok` from `true`
 * to `false` and grow the `violations[]` list.
 *
 * Use case: a user adds a neonicotinoid insecticide via label scan. The
 * kernel doesn't model neonicotinoid chemistry today (that's an
 * insecticide-class concern, not a herbicide-cross-contamination one), so
 * a vanilla kernel verdict would clear the spray. This module lets the
 * user-added stock's declared chemistry add a CROP_INCOMPATIBLE violation
 * when the planted crop is bee-attractive (orchard, legume in bloom).
 *
 * Hard invariant: `augmentSafetyResult(base, …).ok ≤ base.ok`.
 *  Verified by fast-check property test in userAddedRestrictions.test.ts.
 */

import type { SafetyResult, SafetyViolation, SprayContext, ChemistryClass } from './types';

/**
 * A user-added restriction — typically derived from a stock item's
 * `activeIngredientsJson` extras or a plugin's `unsafeCrops` extension.
 *
 * Authors of this list should describe what to BLOCK; the augmenter never
 * relaxes the kernel.
 */
export interface UserAddedRestriction {
  kind: 'chemistry-not-on-crop' | 'product-not-on-crop' | 'pollinator-risk';
  /** Match condition for which (product, crop) combo this fires on. */
  match:
    | { type: 'chemistryClass'; value: ChemistryClass | string }
    | { type: 'productPluginId'; value: string }
    | { type: 'productActiveIngredientName'; value: string };
  /** Block when the planted crop OR any co-planted crop matches one of
   *  these families. Empty array = applies to ALL crops (universal block). */
  blocksWhenCropFamily: ReadonlyArray<string>;
  /** Source of the restriction (for telemetry + UI explainability). */
  source: 'user-stock' | 'plugin' | 'system-default';
  /** Free-form id (e.g. the stockItem.id, plugin.pluginId, etc.). */
  sourceRef: string;
  /** Human-readable explanation for the violation message. */
  reason: string;
}

/**
 * Apply user-added restrictions on top of a base kernel result.
 *
 * - Every original violation is preserved verbatim.
 * - For every restriction whose match fires AND whose blocked-family list
 *   intersects the planted/co-planted families, append a CROP_INCOMPATIBLE
 *   violation tagged with `detail.source: 'user-added'`.
 * - `requiresDecon` is preserved (or set true if any restriction is
 *   chemistry-class based; user-added unknown chemistry is always
 *   "decon-worthy" until proven otherwise).
 * - `ok` is the AND of `base.ok` and "no new violations" — never weaker.
 */
export function augmentSafetyResult(
  base: SafetyResult,
  ctx: SprayContext,
  restrictions: ReadonlyArray<UserAddedRestriction>
): SafetyResult {
  if (restrictions.length === 0) return base;

  const newViolations: SafetyViolation[] = [];
  let addsChemistry = false;
  const cropFamilies = collectCropFamilies(ctx);

  for (const r of restrictions) {
    if (!matchesAnyProduct(r, ctx)) continue;

    // Universal block (empty list) OR family intersection.
    const families = r.blocksWhenCropFamily;
    const universal = families.length === 0;
    const matchedFamily = universal
      ? null
      : families.find((f) => cropFamilies.has(f));
    if (!universal && !matchedFamily) continue;

    if (r.kind === 'chemistry-not-on-crop' || r.kind === 'pollinator-risk') {
      addsChemistry = true;
    }

    newViolations.push({
      code: 'CROP_INCOMPATIBLE',
      message: r.reason,
      detail: {
        source: 'user-added',
        sourceKind: r.source,
        sourceRef: r.sourceRef,
        restrictionKind: r.kind,
        matchedCropFamily: matchedFamily ?? '*',
        match: r.match
      }
    });
  }

  if (newViolations.length === 0) return base;

  return {
    ok: false,
    violations: [...base.violations, ...newViolations],
    requiresDecon: base.requiresDecon || addsChemistry
  };
}

function collectCropFamilies(ctx: SprayContext): ReadonlySet<string> {
  const out = new Set<string>();
  if (ctx.crop.cropFamily) out.add(ctx.crop.cropFamily);
  for (const c of ctx.coPlantedCrops ?? []) {
    if (c.cropFamily) out.add(c.cropFamily);
  }
  return out;
}

function matchesAnyProduct(r: UserAddedRestriction, ctx: SprayContext): boolean {
  for (const p of ctx.products) {
    switch (r.match.type) {
      case 'productPluginId':
        if (p.pluginId === r.match.value) return true;
        break;
      case 'chemistryClass':
        if (p.activeIngredients.some((ai) => ai.chemistryClass === r.match.value)) return true;
        break;
      case 'productActiveIngredientName': {
        const wanted = r.match.value.toLowerCase();
        if (p.activeIngredients.some((ai) => ai.name.toLowerCase() === wanted)) return true;
        break;
      }
    }
  }
  return false;
}
