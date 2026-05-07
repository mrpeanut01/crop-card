import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getStockItem, listLotsForItem, listMovementsForItem } from '$lib/db/stock';

export const load: PageServerLoad = ({ params, locals }) => {
  if (!params.id) throw error(400, 'id required');
  const item = getStockItem(params.id);
  if (!item) throw error(404, `unknown stock item: ${params.id}`);
  return {
    item,
    lots: listLotsForItem(params.id),
    movements: listMovementsForItem(params.id, 100),
    canEdit: locals.user?.role === 'owner'
  };
};
