import {
  AMENDMENT_INVENTORY_TYPE,
  ANIMAL_INVENTORY_TYPES,
  INVENTORY_TYPES,
  type InventoryType
} from './types';

export interface ChipVisibilityInput {
  /** Stock items per type (catalog plugins do not count). */
  stockCounts: Partial<Record<InventoryType, number>>;
  /** Any animal or group on the farm, archived included. */
  hasAnimals: boolean;
  /** The type the page is showing, which always keeps its chip. */
  active?: InventoryType;
}

/** One chip per inventory type, with empty animal types hidden (Phase 32D,
 *  Q3): feed and animal-health show once the farm has animals or stock of
 *  that type, so a crop-only farm sees the same chips it always did.
 *  Manure and compost (33C, M-41) shows once the farm has a batch; its
 *  `stockCounts` entry is the batch count. */
export function visibleInventoryTypes(input: ChipVisibilityInput): InventoryType[] {
  return INVENTORY_TYPES.filter((t) => {
    if (t === AMENDMENT_INVENTORY_TYPE) {
      return t === input.active || (input.stockCounts[t] ?? 0) > 0;
    }
    if (!ANIMAL_INVENTORY_TYPES.includes(t)) return true;
    if (t === input.active) return true;
    if (input.hasAnimals) return true;
    return (input.stockCounts[t] ?? 0) > 0;
  });
}
