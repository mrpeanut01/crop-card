/**
 * Tank-mix order presentation (FR-04).
 *
 * The canonical sequence for any tank load:
 *   1. Half-fill water
 *   2. AMS / water conditioner (if any product requires it)
 *   3. Dry products in plugin tankMixOrder
 *   4. Liquid concentrates in plugin tankMixOrder
 *   5. Surfactants (NIS, COC) in plugin tankMixOrder
 *   6. Top off water
 *   7. Spray within 2 hours
 *
 * For now we surface a numbered checklist sized to the products on hand.
 * Phase 4 introduces explicit dry/liquid/surfactant categories on the plugin
 * so we can group them precisely; today we sort by tankMixOrder and label.
 */

import type { HerbicidePlugin } from '$lib/plugins/schemas';

export interface TankMixStep {
  order: number;
  instruction: string;
  productPluginId?: string;
}

export function buildTankMixSteps(products: HerbicidePlugin[]): TankMixStep[] {
  const steps: TankMixStep[] = [];
  let n = 1;
  steps.push({
    order: n++,
    instruction: 'Half-fill spray tank with clean water and start agitation.'
  });

  if (products.some((p) => p.requiresAMS)) {
    steps.push({
      order: n++,
      instruction: 'Add AMS (ammonium sulfate) FIRST and let it dissolve completely.'
    });
  }

  // Sort products by their declared tankMixOrder (1..10, low first), id-stable.
  const ordered = [...products].sort((a, b) => {
    const ao = a.tankMixOrder ?? 99;
    const bo = b.tankMixOrder ?? 99;
    return ao !== bo ? ao - bo : a.pluginId.localeCompare(b.pluginId);
  });

  for (const p of ordered) {
    steps.push({
      order: n++,
      instruction: `Add ${p.displayName} per dilution table.`,
      productPluginId: p.pluginId
    });
  }

  steps.push({ order: n++, instruction: 'Top off water to final tank volume.' });
  steps.push({ order: n++, instruction: 'Spray within 2 hours of mixing.' });

  return steps;
}
