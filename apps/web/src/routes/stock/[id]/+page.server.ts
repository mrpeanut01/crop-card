import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getStockItem } from '$lib/db/stock';
import { STOCK_CATEGORY_TO_INVENTORY_TYPE } from '$lib/inventory/types';

export const load: PageServerLoad = ({ params }) => {
  if (!params.id) throw error(400, 'id required');
  const item = getStockItem(params.id);
  if (!item) throw error(404, `unknown stock item: ${params.id}`);
  const type = STOCK_CATEGORY_TO_INVENTORY_TYPE[item.category] ?? 'pesticide';
  throw redirect(308, `/inventory/${type}/${encodeURIComponent(params.id)}`);
};
