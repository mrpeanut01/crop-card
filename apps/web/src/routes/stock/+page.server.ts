import type { PageServerLoad } from './$types';
import { loadInventoryView } from '$lib/server/inventoryView';

export const load: PageServerLoad = async ({ locals }) => {
  const canEdit = locals.user?.role === 'owner';
  return {
    canEdit,
    inventory: await loadInventoryView({ canEdit })
  };
};
