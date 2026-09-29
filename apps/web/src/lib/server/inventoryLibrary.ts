import { getRegistry } from '$lib/server/registry';
import type { InventoryType } from '$lib/inventory/types';
import type { LibraryOption } from '$lib/plugins/libraryMatch';

const PLUGIN_TYPES: Record<InventoryType, ReadonlyArray<string>> = {
  seed: ['crop'],
  pesticide: ['herbicide', 'insecticide', 'fungicide'],
  fertility: ['fertilizer'],
  crop: []
};

/** Library entries an inventory item of `type` can link to: crop categories
 *  for seed, product labels for pesticide and fertility (#472). Reads the
 *  per-Owner registry, so farm copies and retirements apply. */
export async function libraryOptionsFor(type: InventoryType): Promise<LibraryOption[]> {
  const allowed = new Set(PLUGIN_TYPES[type]);
  if (allowed.size === 0) return [];
  const registry = await getRegistry();
  const out: LibraryOption[] = [];
  for (const rec of registry.all()) {
    const p = rec.plugin as { type?: string; pluginId: string; displayName: string };
    if (p.type && allowed.has(p.type)) out.push({ id: p.pluginId, name: p.displayName });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
