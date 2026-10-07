import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { INVENTORY_TYPES, type InventoryType } from '$lib/inventory/types';
import { getUserAiEnabled } from '$lib/server/aiTry';
import { libraryOptionsFor } from '$lib/server/inventoryLibrary';
import { canMutate } from '$lib/server/session';
import { getCutting } from '$lib/db/hayCuttings';
import { getBlock } from '$lib/db/blocks';
import { dayContext } from '$lib/server/amendmentRoutes';
import { t } from '$lib/i18n';

/** Sprint 8 / Phase 27D — add route. The form component owns submit
 *  state, this loader validates the `:type` param, threads `aiEnabled` so
 *  the multi-modal add flow can hide Claude-required methods when no key
 *  is configured (Invariant 7), and passes the library the item can link
 *  to (#472). Sprayers are equipment (#474). Manure and compost batches
 *  (33C) take their own form, open to helpers too; `?hayCuttingId=` on
 *  feed links the first lot to a hay cutting (M-39). */
export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (params.type === 'sprayer') throw redirect(308, '/equipment?add=sprayer');
  if (!(INVENTORY_TYPES as readonly string[]).includes(params.type)) {
    throw error(404, `unknown inventory type: ${params.type}`);
  }
  const type = params.type as InventoryType;
  if (type === 'amendment') {
    return {
      type,
      aiEnabled: false,
      canSave: !!locals.user && canMutate(locals.user.role),
      library: [],
      today: dayContext().today,
      hayCutting: null
    };
  }
  let hayCutting: { id: string; label: string; bales: number | null } | null = null;
  const cuttingId = url.searchParams.get('hayCuttingId');
  if (type === 'feed' && cuttingId) {
    const cutting = getCutting(cuttingId);
    if (cutting) {
      const block = getBlock(cutting.blockId);
      hayCutting = {
        id: cutting.id,
        label: t(locals.locale, 'inv.add.hayCuttingLabel', {
          block: block?.name ?? t(locals.locale, 'inv.add.hayBlockFallback'),
          n: cutting.cuttingNumber,
          year: cutting.year
        }),
        bales: cutting.balesQuantity && cutting.balesQuantity > 0 ? cutting.balesQuantity : null
      };
    }
  }
  return {
    type,
    aiEnabled: getUserAiEnabled(locals.user?.id),
    canSave: locals.user?.role === 'owner',
    library: await libraryOptionsFor(type),
    today: null,
    hayCutting
  };
};
