/** Shared loader pieces for the `/animals` pages. */

import { listAreas } from '$lib/db/areas';
import { listAnimalGroups } from '$lib/db/animalGroups';
import { getDataKinds } from '$lib/server/registry';
import { foodProducingExplanation, speciesTiles } from '$lib/plugins/species';
import { housingOptions, type AreaOption, type SpeciesOption } from './display';

export async function speciesOptions(): Promise<SpeciesOption[]> {
  const registry = (await getDataKinds()).species;
  return speciesTiles(registry.all()).map((t) => ({
    ...t,
    explanation: foodProducingExplanation(registry.get(t.id))
  }));
}

export function areaOptions(): AreaOption[] {
  return listAreas().map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
}

export function housingAreaOptions(areas: AreaOption[] = areaOptions()): AreaOption[] {
  return housingOptions(areas);
}

export interface GroupOption {
  id: string;
  name: string;
  speciesId: string;
  housingFieldId: string | null;
}

export function activeGroupOptions(): GroupOption[] {
  return listAnimalGroups({ status: 'active' }).map((g) => ({
    id: g.id,
    name: g.name,
    speciesId: g.speciesId,
    housingFieldId: g.housingFieldId
  }));
}
