import type { PageServerLoad } from './$types';
import { getRegistry } from '$lib/server/registry';

export const load: PageServerLoad = async ({ locals }) => {
  const registry = await getRegistry();
  const all = registry.all();
  return {
    canEdit: locals.user?.role === 'owner',
    /** Just the IDs — used for the uniqueSlug helper that auto-generates
     *  new pluginIds without colliding with the live catalog. */
    existingPluginIds: all.map((r) => r.plugin.pluginId),
    /** Full lookup table for the multi-select picker. The picker shows
     *  display names and stores pluginIds. */
    availablePlugins: all.map((r) => ({
      pluginId: r.plugin.pluginId,
      displayName: r.plugin.displayName,
      type: r.plugin.type
    }))
  };
};
