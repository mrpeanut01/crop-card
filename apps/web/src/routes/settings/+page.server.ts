import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listBlocks } from '$lib/db/blocks';
import { listCrops } from '$lib/db/crops';
import { listEquipment } from '$lib/db/equipment';
import { listStockItems } from '$lib/db/stock';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.user) throw error(401, 'sign-in required');

  const blocks = listBlocks();
  return {
    isOwner: locals.user.role === 'owner',
    counts: {
      blocks: blocks.length,
      crops: listCrops({ limit: 1000 }).length,
      equipment: listEquipment().length,
      stockItems: listStockItems().length
    }
  };
};
