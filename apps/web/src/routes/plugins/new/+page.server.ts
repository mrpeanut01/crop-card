import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  return { canEdit: locals.user?.role === 'owner' };
};
