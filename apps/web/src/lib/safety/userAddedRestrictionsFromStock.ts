/**
 * Phase 17 (Track 2.4) — Build user-added restrictions from stock items.
 *
 * The label-scan flow (Phase 17 Track 2) persists `activeIngredientsJson` on
 * stock items with operator-confirmed chemistry. This module reads that data
 * and emits `UserAddedRestriction[]` for the safety augmenter so the kernel
 * verdict can be stiffened when the label declares more (or different)
 * chemistry than the plugin knows about.
 *
 * Conservative policy: if the stock declares an active ingredient name OR
 * chemistry class that the plugin's declared `activeIngredients[]` doesn't
 * cover, surface a `product-not-on-crop` restriction tied to that plugin.
 * The operator can bypass via the existing structured-bypass-error flow if
 * the discrepancy is acceptable.
 *
 * Why a separate file: the augmenter (`userAddedRestrictions.ts`) takes a
 * generic `UserAddedRestriction[]` and is exhaustively property-tested. The
 * "where do the restrictions come from" mapping is endpoint-layer concern
 * and lives outside that hard-locked module.
 */

import type { StockItem } from '$lib/db/stock';
import type { UserAddedRestriction } from './userAddedRestrictions';

interface StockActiveIngredient {
  name?: string;
  concentrationPct?: number;
  chemistryClass?: string;
  iracGroup?: string;
  fracCode?: string;
}

export interface PluginIngredientView {
  pluginId: string;
  displayName: string;
  /** Plugin-declared ingredient names; chemistryClass field optional because
   *  insecticide plugins don't carry a kernel ChemistryClass. */
  activeIngredients: ReadonlyArray<{ name: string; chemistryClass?: string }>;
}

export interface StockPluginPair {
  stockItem: StockItem;
  plugin: PluginIngredientView;
}

/**
 * For each (stock, plugin) pair, emit a restriction for every active
 * ingredient in `stockItem.activeIngredientsJson` whose name OR
 * chemistryClass is not in the plugin's declared list.
 *
 * Output is deduped per (stockItemId, ingredientName).
 */
export function buildRestrictionsFromStockItems(
  pairs: ReadonlyArray<StockPluginPair>
): UserAddedRestriction[] {
  const out: UserAddedRestriction[] = [];
  const seen = new Set<string>();

  for (const { stockItem, plugin } of pairs) {
    const parsed = parseActiveIngredients(stockItem.activeIngredientsJson);
    if (parsed.length === 0) continue;

    const pluginNames = new Set(plugin.activeIngredients.map((ai) => ai.name.toLowerCase()));
    const pluginChemistries = new Set(
      plugin.activeIngredients.map((ai) => ai.chemistryClass).filter((c): c is string => Boolean(c))
    );

    for (const ai of parsed) {
      if (!ai.name) continue;

      const knownName = pluginNames.has(ai.name.toLowerCase());
      const knownChemistry = ai.chemistryClass ? pluginChemistries.has(ai.chemistryClass) : true;

      if (knownName && knownChemistry) continue;

      const key = `${stockItem.id}::${ai.name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        kind: 'chemistry-not-on-crop',
        match: { type: 'productPluginId', value: plugin.pluginId },
        blocksWhenCropFamily: [],
        source: 'user-stock',
        sourceRef: stockItem.id,
        reason: buildReason(plugin.displayName, ai)
      });
    }
  }

  return out;
}

function parseActiveIngredients(json: string | undefined): StockActiveIngredient[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is StockActiveIngredient => x && typeof x === 'object');
  } catch {
    return [];
  }
}

function buildReason(displayName: string, ai: StockActiveIngredient): string {
  const chemistry = ai.chemistryClass ? ` (${ai.chemistryClass})` : '';
  return `Stock label declares ${ai.name}${chemistry} which the ${displayName} plugin doesn't list. Confirm the product before spraying.`;
}
