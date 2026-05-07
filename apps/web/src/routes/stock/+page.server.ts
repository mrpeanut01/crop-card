import type { PageServerLoad } from './$types';
import { listStockItems } from '$lib/db/stock';
import { getRegistry } from '$lib/server/registry';

export const load: PageServerLoad = async ({ locals }) => {
  const items = listStockItems();
  const registry = await getRegistry();

  // Pre-populate the "from plugin" dropdown for the new-SKU form: any
  // herbicide/insecticide that doesn't yet have a stock item.
  const trackedPluginIds = new Set(
    items.filter((i) => i.pluginId).map((i) => i.pluginId as string)
  );
  const candidatePlugins = registry
    .all()
    .filter((r) => r.plugin.type === 'herbicide' || r.plugin.type === 'insecticide')
    .filter((r) => !trackedPluginIds.has(r.plugin.pluginId))
    .map((r) => ({
      pluginId: r.plugin.pluginId,
      displayName: r.plugin.displayName,
      type: r.plugin.type as 'herbicide' | 'insecticide'
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    items,
    candidatePlugins,
    canEdit: locals.user?.role === 'owner'
  };
};
