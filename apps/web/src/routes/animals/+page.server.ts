import type { PageServerLoad } from './$types';
import { listAnimals } from '$lib/db/animals';
import { listAnimalGroups } from '$lib/db/animalGroups';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { loadAnimalsProfile } from '$lib/animals/profile.server';
import { areaOptions, housingAreaOptions, speciesOptions } from '$lib/animals/pageData.server';

export const load: PageServerLoad = async (event) => {
  const user = currentUser(event);
  const showArchived = event.url.searchParams.get('archived') === '1';
  const areas = areaOptions();
  const groups = listAnimalGroups({ status: showArchived ? 'archived' : 'active' });
  const animals = listAnimals({ status: showArchived ? 'archived' : 'active' });
  const gone = showArchived ? [] : listAnimals({ status: 'gone' });
  const archivedCount = showArchived
    ? 0
    : listAnimalGroups({ status: 'archived' }).length + listAnimals({ status: 'archived' }).length;

  return {
    profile: loadAnimalsProfile(),
    species: await speciesOptions(event.locals?.locale),
    areas,
    housingAreas: housingAreaOptions(areas),
    groups,
    animals,
    gone,
    showArchived,
    archivedCount,
    canEdit: user?.role === 'owner',
    canLog: !!user && canMutate(user.role)
  };
};
