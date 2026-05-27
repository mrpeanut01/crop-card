/**
 * Sprint 9 / Phase 27E (#257) — legacy `/stock/[id]` redirect.
 *
 * The unified inventory detail lives at `/inventory/[type]/[id]`. We
 * resolve the inventory type from the stock item's `category` column so
 * deep links from /today / wizard / external pages still land on the
 * right detail. Unknown items 404; supply-only categories (adjuvant,
 * fuel, part) collapse to the pesticide tab as a soft landing.
 */
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getStockItem } from '$lib/db/stock';

const CATEGORY_TO_TYPE: Record<string, string> = {
  herbicide: 'pesticide',
  insecticide: 'pesticide',
  fungicide: 'pesticide',
  fertilizer: 'fertility',
  seed: 'seed'
};

export const load: PageServerLoad = ({ params }) => {
  if (!params.id) throw error(400, 'id required');
  const item = getStockItem(params.id);
  if (!item) throw error(404, `unknown stock item: ${params.id}`);
  const type = CATEGORY_TO_TYPE[item.category] ?? 'pesticide';
  throw redirect(308, `/inventory/${type}/${encodeURIComponent(params.id)}`);
};
