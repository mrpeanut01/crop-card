import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { INVENTORY_TYPES, type InventoryType } from '$lib/inventory/types';
import { getUserAiEnabled } from '$lib/server/aiTry';

/** Sprint 8 / Phase 27D — add route. The form component owns submit
 *  state, this loader validates the `:type` param against the canonical
 *  5-value enum and threads `aiEnabled` so the multi-modal add flow can
 *  hide Claude-required methods when no key is configured (Invariant 7). */
export const load: PageServerLoad = ({ params, locals }) => {
  if (!(INVENTORY_TYPES as readonly string[]).includes(params.type)) {
    throw error(404, `unknown inventory type: ${params.type}`);
  }
  return {
    type: params.type as InventoryType,
    aiEnabled: getUserAiEnabled(locals.user?.id)
  };
};
