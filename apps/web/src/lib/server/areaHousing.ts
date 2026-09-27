import { listAnimals } from '$lib/db/animals';
import { listAnimalGroups } from '$lib/db/animalGroups';
import { capacityState } from '$lib/animals/counts';
import type { AreaKind } from '$lib/farm/areaKinds';
import type { AreaHousing, HousingByArea } from '$lib/farm/housedAnimals';
import { getFarmAnimals, getFarmProfile } from '$lib/onboarding/state.server';
import { usesPetsLayout } from '$lib/onboarding/profile';
import type { SpeciesPlugin } from '$lib/plugins/schemas';
import type { SpeciesSource } from '$lib/plugins/species';
import { getDataKinds } from '$lib/server/registry';

interface AreaLike {
  id: string;
  kind?: AreaKind | null;
  details?: unknown;
}

function coopCapacity(area: AreaLike): unknown {
  if (area.kind !== 'coop_pen') return undefined;
  return (area.details as { capacity?: unknown } | null | undefined)?.capacity;
}

/** Pure assembly, split out so tests can pass their own rows and species. */
export function buildHousingByArea(input: {
  areas: readonly AreaLike[];
  groups: ReturnType<typeof listAnimalGroups>;
  animals: ReturnType<typeof listAnimals>;
  species: SpeciesSource;
}): HousingByArea {
  const plural = (id: string) => {
    const p: SpeciesPlugin | undefined = input.species.get(id);
    return p ? (p.tile.label ?? p.displayName) : 'Animals';
  };
  const single = (id: string) => input.species.get(id)?.displayName ?? 'Animal';
  const out: HousingByArea = {};
  const slot = (areaId: string): AreaHousing =>
    (out[areaId] ??= { groups: [], animals: [], total: 0, capacity: null });

  for (const g of input.groups) {
    if (g.status !== 'active' || !g.housingFieldId) continue;
    const h = slot(g.housingFieldId);
    h.groups.push({
      id: g.id,
      name: g.name,
      speciesPlural: plural(g.speciesId),
      total: g.total,
      foodProducing: g.effectiveFoodProducing
    });
    h.total += g.total;
  }
  for (const a of input.animals) {
    if (a.status !== 'active' || a.groupId || !a.housingFieldId) continue;
    const h = slot(a.housingFieldId);
    h.animals.push({
      id: a.id,
      name: a.name,
      tag: a.tag,
      speciesName: single(a.speciesId),
      purpose: a.purpose,
      foodProducing: a.foodProducing
    });
    h.total += 1;
  }
  for (const area of input.areas) {
    const cap = coopCapacity(area);
    if (cap === undefined) continue;
    const count = out[area.id]?.total ?? 0;
    const state = capacityState(cap, count);
    if (state) slot(area.id).capacity = state;
  }
  return out;
}

/** Every Area's housed animals for the active Owner, in three reads. */
export async function loadAreaHousing(areas: readonly AreaLike[]): Promise<{
  housing: HousingByArea;
  petsLayout: boolean;
}> {
  const groups = listAnimalGroups({ status: 'active' });
  const animals = listAnimals({ status: 'active', ungrouped: true });
  const petsLayout = usesPetsLayout(getFarmProfile(), getFarmAnimals());
  if (groups.length === 0 && animals.length === 0 && !areas.some((a) => a.kind === 'coop_pen')) {
    return { housing: {}, petsLayout };
  }
  const { species } = await getDataKinds();
  return { housing: buildHousingByArea({ areas, groups, animals, species }), petsLayout };
}
