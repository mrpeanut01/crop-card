import { coopSpeciesOption, type CoopSpeciesOption } from '$lib/farm/coopCapacity';
import { getFarmAnimals } from '$lib/onboarding/state.server';
import { speciesTiles } from '$lib/plugins/species';
import { getDataKinds } from '$lib/server/registry';

/** Species choices for the coop or pen form, in tile order, plus the
 *  onboarding answer used to prefill it. */
export async function loadCoopSpecies(locale?: string | null): Promise<{
  coopSpecies: CoopSpeciesOption[];
  farmAnimals: ReturnType<typeof getFarmAnimals>;
}> {
  const { species } = await getDataKinds();
  const order = speciesTiles(species.all()).map((t) => t.id);
  const coopSpecies = order
    .map((id) => species.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => coopSpeciesOption(p, locale));
  return { coopSpecies, farmAnimals: getFarmAnimals() };
}
