import { getDataKinds } from '$lib/server/registry';
import type { OrganicHealthPluginLookup } from './animalStatus.server';

/** The animal-health library as the organic projection reads it. */
export async function organicHealthPlugins(): Promise<OrganicHealthPluginLookup> {
  const registry = (await getDataKinds()).animalHealth;
  return (pluginId) => {
    const p = registry.get(pluginId);
    return p
      ? { productKind: p.productKind, displayName: p.displayName, organicUse: p.organicUse }
      : undefined;
  };
}
