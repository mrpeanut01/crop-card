import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { INVENTORY_TYPES, type InventoryType } from '$lib/inventory/types';
import { getUserAiEnabled } from '$lib/server/aiTry';
import { libraryOptionsFor } from '$lib/server/inventoryLibrary';

/** Sprint 8 / Phase 27D — add route. The form component owns submit
 *  state, this loader validates the `:type` param, threads `aiEnabled` so
 *  the multi-modal add flow can hide Claude-required methods when no key
 *  is configured (Invariant 7), and passes the library the item can link
 *  to (#472). Sprayers are equipment (#474). */
export const load: PageServerLoad = async ({ params, locals }) => {
  if (params.type === 'sprayer') throw redirect(308, '/equipment?add=sprayer');
  if (!(INVENTORY_TYPES as readonly string[]).includes(params.type)) {
    throw error(404, `unknown inventory type: ${params.type}`);
  }
  const type = params.type as InventoryType;
  return {
    type,
    aiEnabled: getUserAiEnabled(locals.user?.id),
    canSave: locals.user?.role === 'owner',
    library: await libraryOptionsFor(type)
  };
};
