import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEquipment, listEquipmentLog } from '$lib/db/equipment';

export const load: PageServerLoad = ({ params, locals }) => {
  if (!params.id) throw error(400, 'id required');
  const equipment = getEquipment(params.id);
  if (!equipment) throw error(404, `unknown equipment: ${params.id}`);
  return {
    equipment,
    log: listEquipmentLog(params.id, { limit: 100 }),
    canEdit: locals.user != null,
    canRename: locals.user?.role === 'owner'
  };
};
