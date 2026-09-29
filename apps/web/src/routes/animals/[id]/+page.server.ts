import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getAnimal, listFlagChanges } from '$lib/db/animals';
import { getAnimalGroupSummary, listAnimalGroups } from '$lib/db/animalGroups';
import { listLocationsForSubject } from '$lib/db/animalLocations';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { statusEventsWithLocks } from '$lib/server/animals';
import { loadAnimalsProfile } from '$lib/animals/profile.server';
import { pageHoldsFor } from '$lib/server/animalFoodGate';
import { farmTimeZone } from '$lib/db/userProfile';
import { areaOptions, housingAreaOptions, speciesOptions } from '$lib/animals/pageData.server';
import { loadCareSection } from '$lib/server/careView';
import { ymdInZone } from '$lib/prefs';
import { loadToxicPlants } from '$lib/server/toxicPlants';

export const load: PageServerLoad = async (event) => {
  const animal = getAnimal(event.params.id);
  if (!animal) throw error(404, 'Animal not found');
  const user = currentUser(event);
  const species = await speciesOptions();
  const areas = areaOptions();
  const groups = listAnimalGroups({ status: 'all' });
  const today = ymdInZone(Date.now(), farmTimeZone());

  return {
    profile: loadAnimalsProfile(),
    animal,
    species: species.find((s) => s.id === animal.speciesId) ?? null,
    group: animal.groupId ? (getAnimalGroupSummary(animal.groupId) ?? null) : null,
    locations: listLocationsForSubject('animal', animal.id),
    statusEvents: statusEventsWithLocks('animal', animal.id),
    flagChanges: listFlagChanges('animal', animal.id),
    areas,
    housingAreas: housingAreaOptions(areas),
    groupNames: groups.map((g) => ({ id: g.id, name: g.name })),
    joinGroups: groups
      .filter(
        (g) => g.status === 'active' && g.speciesId === animal.speciesId && g.id !== animal.groupId
      )
      .map((g) => ({ id: g.id, name: g.name })),
    ...(await holdsFor('animal', animal.id, farmTimeZone())),
    care: await loadCareSection('animal', animal.id, animal.speciesId, today),
    todayYmd: today,
    ...(await loadToxicPlants()),
    canEdit: user?.role === 'owner',
    canLog: !!user && canMutate(user.role)
  };
};

async function holdsFor(type: 'animal' | 'group', id: string, timeZone: string) {
  const page = await pageHoldsFor(type, id, timeZone);
  return { holds: page?.holds ?? null, foods: page?.foods ?? [] };
}
