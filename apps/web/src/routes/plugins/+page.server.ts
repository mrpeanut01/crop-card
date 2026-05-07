import type { PageServerLoad } from './$types';
import { getRegistry, getRegistryStats } from '$lib/server/registry';

export const load: PageServerLoad = async ({ locals }) => {
  const registry = await getRegistry();
  const stats = getRegistryStats();
  const records = registry.all().map((r) => ({
    pluginId: r.plugin.pluginId,
    type: r.plugin.type,
    displayName: r.plugin.displayName,
    version: r.plugin.version,
    hash: r.hash,
    plugin: r.plugin
  }));
  return {
    records,
    failures: stats.failures,
    loadedAt: stats.loadedAt ?? null,
    canEdit: locals.user?.role === 'owner'
  };
};
