import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import type { CropPlugin } from '$lib/plugins/schemas';
import { getRegistry } from '$lib/server/registry';

export const load: PageServerLoad = async ({ locals }) => {
  const blocks = listBlocks();
  const registry = await getRegistry();
  const crops = registry
    .all()
    .filter((r) => r.plugin.type === 'crop')
    .map((r) => ({
      pluginId: r.plugin.pluginId,
      displayName: r.plugin.displayName,
      cropFamily: r.plugin.type === 'crop' ? r.plugin.cropFamily : undefined
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // FR-13: surface the per-variety planting guide alongside the planting
  // decision instead of buried in plugin JSON. Keyed by pluginId.
  const plantingGuides: Record<string, NonNullable<CropPlugin['plantingGuide']>> = {};
  for (const r of registry.all()) {
    if (r.plugin.type !== 'crop') continue;
    const c = r.plugin as CropPlugin;
    if (c.plantingGuide) plantingGuides[c.pluginId] = c.plantingGuide;
  }

  return {
    blocks,
    crops,
    plantingGuides,
    canEdit: locals.user?.role === 'owner'
  };
};
