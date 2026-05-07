import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
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
  return {
    blocks,
    crops,
    canEdit: locals.user?.role === 'owner'
  };
};
