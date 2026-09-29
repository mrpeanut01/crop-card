import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { INVENTORY_TYPES, type InventoryType } from '$lib/inventory/types';
import { getStockItemWithBalance } from '$lib/db/stock';
import { libraryOptionsFor } from '$lib/server/inventoryLibrary';

/**
 * Sprint 8 / Phase 27D (#257) — edit route loader.
 *
 * Returns the existing item shape that `A_InventoryEditForm` consumes, its
 * on-hand quantity (#473) and the library it can link to (#472). Crop
 * catalog rows are not editable here; the form shows the versioned-upload
 * banner. Sprayers are equipment and 308 to /equipment/[id] (#474).
 */
export const load: PageServerLoad = async ({ params, locals }) => {
  if (params.type === 'sprayer') {
    throw redirect(308, `/equipment/${encodeURIComponent(params.id)}`);
  }
  if (!(INVENTORY_TYPES as readonly string[]).includes(params.type)) {
    throw error(404, `unknown inventory type: ${params.type}`);
  }
  const type = params.type as InventoryType;

  if (type === 'crop') {
    return { type, existing: undefined, library: [], canSave: false };
  }

  const item = getStockItemWithBalance(params.id);
  if (!item) throw error(404, `stock item not found: ${params.id}`);
  return {
    type,
    existing: {
      id: item.id,
      displayName: item.displayName,
      shortName: item.shortName,
      category: item.category,
      defaultUnit: item.defaultUnit,
      pluginId: item.pluginId,
      reorderThreshold: item.reorderThreshold,
      notes: item.notes,
      barcode: item.barcode,
      onHand: item.onHand,
      onOrder: item.onOrder,
      planned: item.planned,
      lotCount: item.lotCount
    },
    library: await libraryOptionsFor(type),
    canSave: locals.user?.role === 'owner'
  };
};
