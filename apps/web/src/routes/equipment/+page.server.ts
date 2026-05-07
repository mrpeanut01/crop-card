import type { PageServerLoad } from './$types';
import { listEquipment } from '$lib/db/equipment';

export const load: PageServerLoad = ({ locals }) => {
  return {
    equipment: listEquipment(),
    canEdit: locals.user?.role === 'owner'
  };
};
