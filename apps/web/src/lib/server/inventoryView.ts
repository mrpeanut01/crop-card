/**
 * Loader for the embedded Inventory editor (lib/components/InventoryView.svelte).
 *
 * The Stock tab in /plan and any future surface that wants to render the
 * inventory editor share this loader so the data shape matches the component
 * contract in one place.
 */

import { listStockItems, type StockCategory } from '$lib/db/stock';
import { getRegistry } from '$lib/server/registry';
import { findTaxonomyTermByName, inventoryDomain, listTaxonomyTerms } from '$lib/db/taxonomy';

const PLUGIN_TYPE_TO_CATEGORY: Record<string, StockCategory> = {
  crop: 'seed',
  herbicide: 'herbicide',
  insecticide: 'insecticide',
  fungicide: 'fungicide',
  fertilizer: 'fertilizer'
};

const FAMILY_TO_TYPE_NAME: Record<string, string> = {
  corn: 'Corn',
  cucurbit: 'Cucurbits',
  legume: 'Legumes',
  'broadleaf-companion': 'Broadleaf companion',
  orchard: 'Orchard',
  'cover-grass': 'Cover crop — grass',
  'cover-legume': 'Cover crop — legume',
  solanaceae: 'Solanaceae',
  brassica: 'Brassicas',
  allium: 'Alliums',
  'leafy-green': 'Leafy greens',
  root: 'Root crops',
  apiaceae: 'Apiaceae',
  'small-fruit': 'Small fruit',
  bramble: 'Brambles',
  'vine-fruit': 'Vine fruit',
  'stone-fruit': 'Stone fruit',
  'cereal-grain': 'Cereal grain',
  forage: 'Forage',
  'herb-culinary': 'Culinary herbs'
};

export async function loadInventoryView(opts: { canEdit: boolean }) {
  const items = listStockItems();
  const registry = await getRegistry();

  const familyByPluginId = new Map<string, string>();
  for (const r of registry.all()) {
    const p = r.plugin as { type?: string; pluginId: string; cropFamily?: string };
    if (p.type === 'crop' && p.cropFamily) familyByPluginId.set(p.pluginId, p.cropFamily);
  }
  const taxonomy = listTaxonomyTerms();
  const typeById = new Map(taxonomy.map((t) => [t.id, t]));
  const itemsWithType = items.map((item) => {
    let typeId = item.typeId;
    let typeName: string | undefined;
    if (typeId) typeName = typeById.get(typeId)?.name;
    if (!typeId && item.category === 'seed' && item.pluginId) {
      const family = familyByPluginId.get(item.pluginId);
      const fallbackName = family ? FAMILY_TO_TYPE_NAME[family] : undefined;
      if (fallbackName) {
        const term = findTaxonomyTermByName(inventoryDomain('seed'), fallbackName);
        if (term) {
          typeId = term.id;
          typeName = term.name;
        }
      }
    }
    return { ...item, typeId, typeName };
  });

  const catalogPlugins = registry
    .all()
    .map((r) => {
      const p = r.plugin as {
        type?: string;
        pluginId: string;
        displayName: string;
      } & Record<string, unknown>;
      const category = PLUGIN_TYPE_TO_CATEGORY[p.type ?? ''];
      if (!category) return null;

      const meta: Record<string, unknown> = {};
      if (p.type === 'crop') {
        const dtm = p.daysToMaturity as { min: number; max: number } | undefined;
        if (dtm) {
          meta.daysToMaturity =
            dtm.min === dtm.max ? dtm.min : Math.round((dtm.min + dtm.max) / 2);
          meta.daysToMaturityRange = dtm;
        }
        const pg = p.plantingGuide as Record<string, unknown> | undefined;
        if (pg) {
          if (pg.soilTempMinF != null) meta.plantingTempMinF = pg.soilTempMinF;
          if (pg.rowSpacingIn != null) meta.spacingInches = pg.rowSpacingIn;
          const sd = pg.seedDepthIn as { min: number; max: number } | undefined;
          if (sd?.min != null) meta.depthInches = sd.min;
          if (pg.seedsPerAcre != null) meta.seedsPerAcre = pg.seedsPerAcre;
        }
        if (p.preHarvestIntervalDays != null)
          meta.preHarvestIntervalDays = p.preHarvestIntervalDays;
        if (p.cropFamily) meta.cropFamily = p.cropFamily;
      } else {
        if (p.reEntryIntervalHours != null) meta.reEntryIntervalHours = p.reEntryIntervalHours;
        if (p.preHarvestIntervalDays != null)
          meta.preHarvestIntervalDays = p.preHarvestIntervalDays;
        if (p.ratePerAcre) meta.ratePerAcre = p.ratePerAcre;
        if (p.epaRegistrationNumber) meta.epaRegistrationNumber = p.epaRegistrationNumber;
        const ai = p.activeIngredients as Array<{ name: string }> | undefined;
        if (Array.isArray(ai)) meta.activeIngredients = ai.map((a) => a.name);
      }
      if (p.notes) meta.notes = p.notes;

      return { pluginId: p.pluginId, displayName: p.displayName, category, meta };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    items: itemsWithType,
    catalogPlugins,
    taxonomy,
    canEdit: opts.canEdit
  };
}
