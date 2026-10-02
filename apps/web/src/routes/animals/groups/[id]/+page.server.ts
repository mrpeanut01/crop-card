import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listFlagChanges, listGroupMembers } from '$lib/db/animals';
import { getAnimalGroupSummary, listAnimalGroups } from '$lib/db/animalGroups';
import { listLocationsForSubject } from '$lib/db/animalLocations';
import { currentUser } from '$lib/server/auth';
import { canMutate } from '$lib/server/session';
import { statusEventsWithLocks } from '$lib/server/animals';
import { withMeatHoldMarks } from '$lib/server/coveredRecords';
import { canVoidHolds, voidableUntilMs } from '$lib/server/holdVoid';
import { loadAnimalsProfile } from '$lib/animals/profile.server';
import { pageHoldsFor } from '$lib/server/animalFoodGate';
import { farmTimeZone } from '$lib/db/userProfile';
import { areaOptions, housingAreaOptions, speciesOptions } from '$lib/animals/pageData.server';
import { loadCareSection } from '$lib/server/careView';
import { ymdInZone } from '$lib/prefs';
import { loadToxicPlants } from '$lib/server/toxicPlants';
import { t } from '$lib/i18n';

export const load: PageServerLoad = async (event) => {
  const group = getAnimalGroupSummary(event.params.id);
  if (!group) throw error(404, t(event.locals?.locale, 'animallib.api.groupPageNotFound'));
  const user = currentUser(event);
  const species = await speciesOptions();
  const areas = areaOptions();
  const today = ymdInZone(Date.now(), farmTimeZone());

  return {
    profile: loadAnimalsProfile(),
    group,
    species: species.find((s) => s.id === group.speciesId) ?? null,
    members: listGroupMembers(group.id),
    locations: listLocationsForSubject('group', group.id),
    statusEvents: (
      await withMeatHoldMarks(statusEventsWithLocks('group', group.id), farmTimeZone())
    ).map((e) => ({ ...e, voidableUntilMs: voidableUntilMs(e.createdAt) })),
    canVoidHolds: canVoidHolds(event, user),
    flagChanges: listFlagChanges('group', group.id),
    areas,
    housingAreas: housingAreaOptions(areas),
    groupNames: listAnimalGroups({ status: 'all' }).map((g) => ({ id: g.id, name: g.name })),
    ...(await holdsFor('group', group.id, farmTimeZone())),
    care: await loadCareSection('group', group.id, group.speciesId, today, event.locals?.locale),
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
