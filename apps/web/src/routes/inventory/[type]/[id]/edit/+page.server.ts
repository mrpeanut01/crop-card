import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { INVENTORY_TYPES, type InventoryType } from '$lib/inventory/types';
import { getStockItem } from '$lib/db/stock';
import { getEquipment } from '$lib/db/equipment';

/**
 * Sprint 8 / Phase 27D (#257) — edit route loader.
 *
 * Returns the existing item shape that `A_InventoryEditForm` consumes.
 * Crop catalog rows are NOT editable from this surface — the form
 * component renders the "use /settings/plugins" banner instead — so
 * the loader returns null and lets the form short-circuit.
 */
export const load: PageServerLoad = ({ params }) => {
  if (!(INVENTORY_TYPES as readonly string[]).includes(params.type)) {
    throw error(404, `unknown inventory type: ${params.type}`);
  }
  const type = params.type as InventoryType;

  if (type === 'sprayer') {
    const eq = getEquipment(params.id);
    if (!eq || eq.type !== 'sprayer') {
      throw error(404, `sprayer not found: ${params.id}`);
    }
    return {
      type,
      existing: {
        id: eq.id,
        label: eq.label,
        notes: eq.notes,
        spec: eq.spec
      }
    };
  }

  if (type === 'crop') {
    // Crop plugin editing is versioned — the form will render the
    // /settings/plugins deep-link banner.
    return { type, existing: undefined };
  }

  const item = getStockItem(params.id);
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
      barcode: item.barcode
    }
  };
};
