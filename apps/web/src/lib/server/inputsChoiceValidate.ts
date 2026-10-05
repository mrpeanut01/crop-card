/**
 * #480 — server re-check of every product being committed from the Inputs
 * step. `productSource` is set by the client, so it is never trusted: every
 * row with a product is checked, in the same order as the AI validator pyramid: the season's
 * philosophy filter, then crop compatibility, then the label rate ceiling.
 * Crop compatibility is checked where the crop is already in the ground
 * (post-emergent herbicides); a burndown or pre-emergent spray goes on
 * before the crop is up.
 */

import { isProductAllowed } from '$lib/season/philosophyFilter';
import type { Philosophy } from '$lib/season/setup';
import { checkCropCompatibility } from '$lib/safety/cropCompatibility';
import type { ChemistryClass } from '$lib/safety/types';
import type { CropPlugin, HerbicidePlugin } from '$lib/plugins/schemas';
import { rateCeilingProblem } from '$lib/plan/rateCeiling';

export interface ManualChoice {
  id: string;
  slot: string;
  cropPluginId: string;
  productPluginId: string | null;
  productCategory: 'herbicide' | 'insecticide' | 'fungicide' | 'fertilizer';
  rateAmount: number | null;
  rateUnit?: string | null;
  productSource?: string;
}

export interface ChoiceContext {
  products: ReadonlyMap<string, { type: string; pluginId: string; displayName: string }>;
  cropPlugins: Readonly<Record<string, CropPlugin>>;
  philosophy: Philosophy | null;
}

export function validateManualChoices(
  applications: ReadonlyArray<ManualChoice>,
  ctx: ChoiceContext
): string[] {
  const problems: string[] = [];
  for (const app of applications) {
    if (!app.productPluginId) continue;
    const plugin = ctx.products.get(app.productPluginId);
    if (!plugin || plugin.type !== app.productCategory) {
      problems.push(`${app.productPluginId} is not a known ${app.productCategory}.`);
      continue;
    }
    if (
      ctx.philosophy &&
      !isProductAllowed(plugin as Parameters<typeof isProductAllowed>[0], ctx.philosophy)
    ) {
      problems.push(`${plugin.displayName} is not allowed under your ${ctx.philosophy} season.`);
      continue;
    }
    const crop = ctx.cropPlugins[app.cropPluginId];
    if (plugin.type === 'herbicide' && app.slot === 'post-emergent' && crop) {
      const h = plugin as unknown as HerbicidePlugin;
      const issues = checkCropCompatibility(
        [
          {
            pluginId: h.pluginId,
            displayName: h.displayName,
            activeIngredients: h.activeIngredients.map((ai) => ({
              name: ai.name,
              chemistryClass: ai.chemistryClass as ChemistryClass
            }))
          }
        ],
        { cropPluginId: crop.pluginId, cropFamily: crop.cropFamily }
      );
      if (issues.length > 0) {
        problems.push(`${plugin.displayName} would harm ${crop.displayName}.`);
        continue;
      }
    }
    const ceiling = (plugin as { ratePerAcre?: { amount?: number; unit?: string } }).ratePerAcre;
    if (typeof ceiling?.amount === 'number' && app.rateAmount != null) {
      const label = { amount: ceiling.amount, unit: ceiling.unit ?? null };
      const problem = rateCeilingProblem(app.rateAmount, app.rateUnit, label);
      if (problem === 'over') {
        problems.push(
          `${plugin.displayName} is above its label rate (${label.amount}${label.unit ? ` ${label.unit}` : ''} per acre).`
        );
      } else if (problem === 'unit') {
        problems.push(
          `${plugin.displayName} rate must be in ${label.unit ?? 'its label unit'} per acre, not ${app.rateUnit}.`
        );
      } else if (problem === 'not-positive') {
        problems.push(`${plugin.displayName} needs a rate above zero.`);
      }
    }
  }
  return problems;
}
