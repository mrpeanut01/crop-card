import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSprayer, listSprayers } from '$lib/server/sprayers';

export const load: PageServerLoad = async ({ url }) => {
  const requestedId = url.searchParams.get('sprayer');
  if (requestedId) {
    const sprayer = getSprayer(requestedId);
    if (!sprayer) throw error(404, `unknown sprayer: ${requestedId}`);
    return { sprayer, sprayers: listSprayers() };
  }
  return { sprayer: null, sprayers: listSprayers() };
};
