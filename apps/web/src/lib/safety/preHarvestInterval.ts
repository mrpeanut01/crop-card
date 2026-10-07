/**
 * #661 — the pre-harvest interval a pesticide sets for one crop.
 *
 * A label lists PHIs by crop. A plugin may carry them in
 * `preHarvestIntervalsByCrop`; `preHarvestIntervalDays` stays the one
 * value for every crop. The rule:
 *
 * - No by-crop table: the single value (null when none is on file).
 * - A table entry names the crop's plugin id: the longest such entry.
 * - Otherwise an entry names the crop's family: the longest such entry.
 * - Otherwise (crop not listed, or not known): the longest value on file,
 *   table and single value together. Never the shortest.
 *
 * Pure and client-safe.
 */

export interface PhiByCropEntry {
  cropPluginId?: string;
  cropFamily?: string;
  preHarvestIntervalDays: number;
}

export interface PhiProduct {
  preHarvestIntervalDays?: number | null;
  preHarvestIntervalsByCrop?: readonly PhiByCropEntry[] | null;
}

export interface PhiCrop {
  cropPluginId?: string | null;
  family?: string | null;
}

export type PhiBasis = 'crop' | 'family' | 'longest' | 'single' | 'none';

export interface PhiForCrop {
  days: number | null;
  basis: PhiBasis;
}

function longestOf(values: readonly number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

/** The longest PHI on file for any crop, table and single value together. */
export function longestPhiDays(product: PhiProduct): number | null {
  const values = (product.preHarvestIntervalsByCrop ?? []).map((e) => e.preHarvestIntervalDays);
  if (typeof product.preHarvestIntervalDays === 'number') {
    values.push(product.preHarvestIntervalDays);
  }
  return longestOf(values);
}

export function phiDaysForCrop(product: PhiProduct, crop: PhiCrop | null | undefined): PhiForCrop {
  const table = product.preHarvestIntervalsByCrop ?? [];
  if (table.length === 0) {
    const single = product.preHarvestIntervalDays;
    return typeof single === 'number'
      ? { days: single, basis: 'single' }
      : { days: null, basis: 'none' };
  }
  const pluginId = crop?.cropPluginId ?? null;
  if (pluginId) {
    const byId = longestOf(
      table.filter((e) => e.cropPluginId === pluginId).map((e) => e.preHarvestIntervalDays)
    );
    if (byId !== null) return { days: byId, basis: 'crop' };
  }
  const family = crop?.family ?? null;
  if (family) {
    const byFamily = longestOf(
      table.filter((e) => e.cropFamily === family).map((e) => e.preHarvestIntervalDays)
    );
    if (byFamily !== null) return { days: byFamily, basis: 'family' };
  }
  return { days: longestPhiDays(product), basis: 'longest' };
}

/**
 * The PHI across several crops a spray may reach (e.g. every planting on
 * the block): the longest of each crop's PHI. No crops known reads as an
 * unlisted crop, so the longest value on file.
 */
export function phiDaysForCrops(product: PhiProduct, crops: readonly PhiCrop[]): number | null {
  if (crops.length === 0) return phiDaysForCrop(product, null).days;
  const values = crops
    .map((c) => phiDaysForCrop(product, c).days)
    .filter((d): d is number => d !== null);
  return longestOf(values);
}
