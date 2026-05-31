import { redirect, type ServerLoad } from '@sveltejs/kit';
import { STOCK_CATEGORY_TO_INVENTORY_TYPE } from '$lib/inventory/types';

/** Legacy `/stock/add` shell (Phase 27E cutover). Preserve the caller's
 *  intent: map `?category=` to the new inventory taxonomy so a seed link
 *  lands on `/inventory/seed/add`, not the old hardcoded pesticide page.
 *  No category → the type picker, not a wrong-type guess. */
export const load: ServerLoad = ({ url }) => {
  const category = url.searchParams.get('category');
  const type = category ? STOCK_CATEGORY_TO_INVENTORY_TYPE[category] : undefined;
  throw redirect(308, type ? `/inventory/${type}/add` : '/inventory');
};
