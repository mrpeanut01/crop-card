import type { PageServerLoad } from './$types';
import { currentUser } from '$lib/server/auth';
import { loadAnimalsProfile } from '$lib/animals/profile.server';
import { suggestedSpecies } from '$lib/animals/profile';
import {
  activeGroupOptions,
  housingAreaOptions,
  speciesOptions
} from '$lib/animals/pageData.server';

export const load: PageServerLoad = async (event) => {
  const user = currentUser(event);
  const profile = loadAnimalsProfile();
  const params = event.url.searchParams;
  const raw = params.get('mode');
  const mode: 'one' | 'group' | null = raw === 'group' || raw === 'one' ? raw : null;
  return {
    profile,
    species: await speciesOptions(),
    areas: housingAreaOptions(),
    groups: activeGroupOptions(),
    canEdit: user?.role === 'owner',
    initialSpecies: params.get('species') ?? suggestedSpecies(profile.choices),
    initialMode: mode,
    initialAreaId: params.get('area')
  };
};
