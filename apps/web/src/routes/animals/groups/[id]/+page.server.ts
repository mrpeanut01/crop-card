import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listFlagChanges, listGroupMembers } from '$lib/db/animals';
import { getAnimalGroupSummary, listAnimalGroups } from '$lib/db/animalGroups';
import { listLocationsForSubject } from '$lib/db/animalLocations';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { statusEventsWithLocks } from '$lib/server/animals';
import { loadAnimalsProfile } from '$lib/animals/profile.server';
import { areaOptions, housingAreaOptions, speciesOptions } from '$lib/animals/pageData.server';

export const load: PageServerLoad = async (event) => {
  const group = getAnimalGroupSummary(event.params.id);
  if (!group) throw error(404, 'Group not found');
  const user = currentUser(event);
  const species = await speciesOptions();
  const areas = areaOptions();

  return {
    profile: loadAnimalsProfile(),
    group,
    species: species.find((s) => s.id === group.speciesId) ?? null,
    members: listGroupMembers(group.id),
    locations: listLocationsForSubject('group', group.id),
    statusEvents: statusEventsWithLocks('group', group.id),
    flagChanges: listFlagChanges('group', group.id),
    areas,
    housingAreas: housingAreaOptions(areas),
    groupNames: listAnimalGroups({ status: 'all' }).map((g) => ({ id: g.id, name: g.name })),
    canEdit: user?.role === 'owner',
    canLog: !!user && canMutate(user.role)
  };
};
