import { listAnimals } from '$lib/db/animals';
import { listAnimalGroups } from '$lib/db/animalGroups';
import { listFields } from '$lib/db/fields';
import type { AnimalsHere, AnimalsHereRow, SprayPastureContext } from '$lib/farm/pastureNotice';
import type { GrazingRestrictions } from '$lib/plugins/schemas';
import type { PluginRegistry } from '$lib/plugins/registry';
import type { SpeciesSource } from '$lib/plugins/species';
import { farmCopyRestrictions, presumeLactating } from '$lib/safety/grazingInterval';
import { getBaseRegistry, getDataKinds } from '$lib/server/registry';

interface BlockLike {
  id: string;
  fieldId?: string | null;
}

/** Pure assembly, split out for tests. */
export function buildAnimalsByArea(input: {
  fields: readonly { id: string; name: string }[];
  groups: ReturnType<typeof listAnimalGroups>;
  animals: ReturnType<typeof listAnimals>;
  species: SpeciesSource;
}): Record<string, AnimalsHere> {
  const names = new Map(input.fields.map((f) => [f.id, f.name]));
  const out: Record<string, AnimalsHere> = {};
  const add = (areaId: string, row: AnimalsHereRow) => {
    (out[areaId] ??= { areaName: names.get(areaId) ?? 'this Area', rows: [] }).rows.push(row);
  };
  const products = (id: string) => input.species.get(id)?.products ?? [];
  const plural = (id: string) => {
    const p = input.species.get(id);
    return (p?.tile.label ?? p?.displayName ?? 'animals').toLowerCase();
  };
  for (const g of input.groups) {
    if (g.status !== 'active' || !g.housingFieldId || g.total <= 0) continue;
    add(g.housingFieldId, {
      label: `${g.total} ${plural(g.speciesId)} (${g.name})`,
      speciesId: g.speciesId,
      foodProducing: g.effectiveFoodProducing,
      lactating: presumeLactating({ speciesProducts: products(g.speciesId) })
    });
  }
  for (const a of input.animals) {
    if (a.status !== 'active' || a.groupId || !a.housingFieldId) continue;
    const species = input.species.get(a.speciesId)?.displayName ?? 'animal';
    add(a.housingFieldId, {
      label: a.name?.trim() ? `${a.name.trim()} (${species.toLowerCase()})` : species,
      speciesId: a.speciesId,
      foodProducing: a.foodProducing,
      lactating: presumeLactating({ speciesProducts: products(a.speciesId), sex: a.sex })
    });
  }
  return out;
}

const PESTICIDES = new Set(['herbicide', 'insecticide', 'fungicide']);

function grazingOf(registry: PluginRegistry, pluginId: string): GrazingRestrictions | undefined {
  const p = registry.get(pluginId)?.plugin;
  if (!p || !PESTICIDES.has(p.type)) return undefined;
  return (p as { grazingRestrictions?: GrazingRestrictions }).grazingRestrictions;
}

/** The same label data the grazing gate reads: the shared library, made
 *  only stricter by a farm's own copy (`farmCopyRestrictions`). */
function restrictionsByPlugin(
  registry: PluginRegistry,
  base: PluginRegistry
): Record<string, GrazingRestrictions> {
  const out: Record<string, GrazingRestrictions> = {};
  for (const { plugin } of registry.all()) {
    if (!PESTICIDES.has(plugin.type)) continue;
    const shared = base.get(plugin.pluginId)?.plugin;
    const farm = shared === plugin ? undefined : grazingOf(registry, plugin.pluginId);
    const r = farmCopyRestrictions(grazingOf(base, plugin.pluginId), farm);
    if (r) out[plugin.pluginId] = r;
  }
  return out;
}

/**
 * Animals living on the Areas of the spray page's blocks, for the advisory
 * pasture notice. Null when none of those Areas houses an animal.
 */
export async function loadSprayPastureContext(
  blocks: readonly BlockLike[],
  registry: PluginRegistry
): Promise<SprayPastureContext | null> {
  const groups = listAnimalGroups({ status: 'active' });
  const animals = listAnimals({ status: 'active', ungrouped: true });
  if (groups.length === 0 && animals.length === 0) return null;
  const blockArea: Record<string, string> = {};
  for (const b of blocks) if (b.fieldId) blockArea[b.id] = b.fieldId;
  const areaIds = new Set(Object.values(blockArea));
  const housed = [...groups.map((g) => g.housingFieldId), ...animals.map((a) => a.housingFieldId)];
  if (!housed.some((id) => id && areaIds.has(id))) return null;
  const { species } = await getDataKinds();
  const animalsByArea = buildAnimalsByArea({ fields: listFields(), groups, animals, species });
  return {
    animalsByArea,
    blockArea,
    restrictionsByPlugin: restrictionsByPlugin(registry, await getBaseRegistry())
  };
}
