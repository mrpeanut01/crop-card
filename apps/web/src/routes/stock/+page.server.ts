import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { STOCK_CATEGORY_TO_INVENTORY_TYPE } from '$lib/inventory/types';

export const load: PageServerLoad = ({ url }) => {
  const category = url.searchParams.get('category');
  const type = (category && STOCK_CATEGORY_TO_INVENTORY_TYPE[category]) ?? 'pesticide';
  throw redirect(308, `/inventory?type=${type}`);
};
