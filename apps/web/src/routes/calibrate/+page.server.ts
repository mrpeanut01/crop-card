import type { PageServerLoad } from './$types';
import { listSprayers } from '$lib/server/sprayers';

export const load: PageServerLoad = ({ locals }) => {
  return {
    sprayers: listSprayers(),
    canSave: locals.user?.role === 'owner'
  };
};
