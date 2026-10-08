import { getDataKinds, getRegistry } from '$lib/server/registry';
import type { InventoryType } from '$lib/inventory/types';
import type { LibraryOption } from '$lib/plugins/libraryMatch';
import type { HealthPluginRef } from '$lib/stock/animalStock';
import { sameNameDetails, type NamedPlugin } from '$lib/plugins/sameName';

const PLUGIN_TYPES: Record<InventoryType, ReadonlyArray<string>> = {
  seed: ['crop'],
  pesticide: ['herbicide', 'insecticide', 'fungicide'],
  fertility: ['fertilizer'],
  crop: [],
  feed: [],
  'animal-health': [],
  amendment: []
};

/** Library entries an inventory item of `type` can link to: crop categories
 *  for seed, product labels for pesticide and fertility (#472), and
 *  animal-health products for medicine (Phase 32D). Reads the per-Owner
 *  registry, so farm copies and retirements apply. Feed has no library. */
export async function libraryOptionsFor(type: InventoryType): Promise<LibraryOption[]> {
  if (type === 'animal-health') {
    return (await animalHealthRefs()).map((p) => ({
      id: p.pluginId,
      name: p.displayName,
      ...(p.approval && (p.approval.kind === 'NADA' || p.approval.kind === 'ANADA')
        ? { approval: { kind: p.approval.kind, number: p.approval.number } }
        : {})
    }));
  }
  const allowed = new Set(PLUGIN_TYPES[type]);
  if (allowed.size === 0) return [];
  const registry = await getRegistry();
  const picked: Array<NamedPlugin & { pluginId: string; displayName: string }> = [];
  for (const rec of registry.all()) {
    const p = rec.plugin as NamedPlugin & { type?: string; pluginId: string; displayName: string };
    if (p.type && allowed.has(p.type)) picked.push(p);
  }
  const details = type === 'seed' ? [] : sameNameDetails(picked);
  const out: LibraryOption[] = picked.map((p, i) => ({
    id: p.pluginId,
    name: details[i] ? `${p.displayName} (${details[i]})` : p.displayName
  }));
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Registered animal-health products with their approval numbers, for the
 *  NADA match on a label scan. */
export async function animalHealthRefs(): Promise<HealthPluginRef[]> {
  return (await getDataKinds()).animalHealth
    .all()
    .map((p) => ({ pluginId: p.pluginId, displayName: p.displayName, approval: p.approval }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
