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
import { loadToxicPlants } from '$lib/server/toxicPlants';
import type { ToxicPlantsByArea } from '$lib/animals/toxicAdjacency';

interface AreaLike {
  id: string;
  kind?: AreaKind | null;
  details?: unknown;
}

function coopCapacity(
  area: AreaLike
): { value: unknown; provenance: 'data' | 'manual' } | undefined {
  if (area.kind !== 'coop_pen') return undefined;
  const d = area.details as { capacity?: unknown; capacityProvenance?: unknown } | null | undefined;
  if (d?.capacity === undefined) return undefined;
  return { value: d.capacity, provenance: d.capacityProvenance === 'data' ? 'data' : 'manual' };
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
  const heads = new Map<string, Map<string, number>>();
  const count = (areaId: string, speciesId: string, n: number) => {
    const m = heads.get(areaId) ?? new Map<string, number>();
    m.set(speciesId, (m.get(speciesId) ?? 0) + n);
    heads.set(areaId, m);
  };
  for (const g of input.groups) {
    if (g.status === 'active' && g.housingFieldId) count(g.housingFieldId, g.speciesId, g.total);
  }
  for (const a of input.animals) {
    if (a.status === 'active' && !a.groupId && a.housingFieldId) {
      count(a.housingFieldId, a.speciesId, 1);
    }
  }
  for (const [areaId, m] of heads) {
    if (!out[areaId]) continue;
    out[areaId].speciesIds = [...m.entries()]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .map(([id]) => id);
  }
  for (const area of input.areas) {
    const cap = coopCapacity(area);
    if (cap === undefined) continue;
    const count = out[area.id]?.total ?? 0;
    const state = capacityState(cap.value, count);
    if (state) {
      const h = slot(area.id);
      h.capacity = state;
      h.capacityProvenance = cap.provenance;
    }
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
  const housing = buildHousingByArea({ areas, groups, animals, species });
  if (Object.values(housing).some((h) => h.speciesIds?.length)) {
    const { toxicPlants, speciesPlural } = await loadToxicPlants();
    attachToxicPlants(housing, toxicPlants, speciesPlural);
  }
  return { housing, petsLayout };
}

/** Adds each housed Area's toxic crops and its species' plural words, so
 *  `withHousing` can add the advisory callout. Pure; mutates `housing`. */
export function attachToxicPlants(
  housing: HousingByArea,
  toxicPlants: ToxicPlantsByArea,
  speciesPlural: Record<string, string>
): HousingByArea {
  for (const [areaId, h] of Object.entries(housing)) {
    const crops = toxicPlants[areaId];
    if (!crops?.length || !h.speciesIds?.length) continue;
    h.toxicPlants = crops;
    h.speciesPlural = Object.fromEntries(
      h.speciesIds.filter((id) => speciesPlural[id]).map((id) => [id, speciesPlural[id]])
    );
  }
  return housing;
}
