/** #649 #648 #745: the stock a health record can take a dose from. Client-safe. */

export interface HealthStockOption {
  id: string;
  name: string;
  unit: string;
  /** The lot number when the item has exactly one lot on hand. */
  lotNumber?: string | null;
}

/** Animal-health bottles, or items that carry an animal-health plugin.
 *  Seed, crop pesticides, fertilizer and feed are never doses. */
export function isHealthStock(
  item: { category: string; pluginId?: string | null },
  isHealthPlugin: (pluginId: string) => boolean
): boolean {
  return item.category === 'animal-health' || (!!item.pluginId && isHealthPlugin(item.pluginId));
}

const UNIT_SHOWN: Record<string, string> = { ml: 'mL', l: 'L' };

/** The dose unit to prefill for a picked bottle, as the unit list shows it. */
export function doseUnitFor(stockUnit: string): string {
  return UNIT_SHOWN[stockUnit] ?? stockUnit;
}
