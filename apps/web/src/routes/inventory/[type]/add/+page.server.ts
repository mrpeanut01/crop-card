import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { INVENTORY_TYPES, type InventoryType } from '$lib/inventory/types';

/** Sprint 8 / Phase 27D — add route. The form component owns submit
 *  state, this loader just validates the `:type` param against the
 *  canonical 5-value enum so a typo lands a 404 instead of a confusing
 *  empty form. */
export const load: PageServerLoad = ({ params }) => {
  if (!(INVENTORY_TYPES as readonly string[]).includes(params.type)) {
    throw error(404, `unknown inventory type: ${params.type}`);
  }
  return { type: params.type as InventoryType };
};
