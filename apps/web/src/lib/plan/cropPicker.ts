import { convert, type StockUnit } from '$lib/stock/units';

export interface PickerCrop {
  pluginId: string;
  displayName: string;
  cropFamily?: string | null;
}

export interface PickerSeed {
  stockItemId: string;
  displayName: string;
  shortName?: string | null;
  onHand: number;
  defaultUnit: StockUnit;
  cropPluginId: string | null;
}

export type PickerOption =
  { kind: 'seed'; seed: PickerSeed; crop: PickerCrop } | { kind: 'crop'; crop: PickerCrop };

export interface PickerResults {
  seeds: Array<Extract<PickerOption, { kind: 'seed' }>>;
  crops: Array<Extract<PickerOption, { kind: 'crop' }>>;
  /** Catalog matches beyond `limit`, so the UI can say "keep typing". */
  moreCrops: number;
}

/** Units offered for a planting amount. `count` reads as "plants". */
export const PLANTING_UNITS: ReadonlyArray<{ value: StockUnit; label: string }> = [
  { value: 'seeds', label: 'seeds' },
  { value: 'count', label: 'plants' },
  { value: 'oz', label: 'oz' },
  { value: 'lb', label: 'lb' },
  { value: 'g', label: 'g' }
];

export function unitLabel(unit: string): string {
  return PLANTING_UNITS.find((u) => u.value === unit)?.label ?? unit;
}

function score(haystacks: Array<string | null | undefined>, q: string): number {
  let best = -1;
  for (const h of haystacks) {
    if (!h) continue;
    const s = h.toLowerCase();
    if (s.startsWith(q)) best = Math.max(best, 3);
    else if (s.split(/[\s\-(/]+/).some((w) => w.startsWith(q))) best = Math.max(best, 2);
    else if (s.includes(q)) best = Math.max(best, 1);
  }
  return best;
}

/** Seed on hand first (it is what's in the shed), then the rest of the
 *  catalog. A crop with seed on hand is listed only under its seed. */
export function searchCrops(
  query: string,
  seeds: ReadonlyArray<PickerSeed>,
  catalog: ReadonlyArray<PickerCrop>,
  limit = 8
): PickerResults {
  const q = query.trim().toLowerCase();
  const byId = new Map(catalog.map((c) => [c.pluginId, c]));

  const seedRows: Array<{ opt: Extract<PickerOption, { kind: 'seed' }>; s: number }> = [];
  const seededIds = new Set<string>();
  for (const seed of seeds) {
    if (seed.onHand <= 0 || !seed.cropPluginId) continue;
    const crop = byId.get(seed.cropPluginId);
    if (!crop) continue;
    seededIds.add(crop.pluginId);
    const s = q
      ? score([seed.shortName, seed.displayName, crop.displayName, crop.cropFamily], q)
      : 0;
    if (s >= 0) seedRows.push({ opt: { kind: 'seed', seed, crop }, s });
  }
  seedRows.sort(
    (a, b) =>
      b.s - a.s ||
      (a.opt.seed.shortName ?? a.opt.seed.displayName).localeCompare(
        b.opt.seed.shortName ?? b.opt.seed.displayName
      )
  );

  const cropRows: Array<{ opt: Extract<PickerOption, { kind: 'crop' }>; s: number }> = [];
  for (const crop of catalog) {
    if (seededIds.has(crop.pluginId)) continue;
    const s = q ? score([crop.displayName, crop.cropFamily], q) : 0;
    if (s >= 0) cropRows.push({ opt: { kind: 'crop', crop }, s });
  }
  cropRows.sort(
    (a, b) => b.s - a.s || a.opt.crop.displayName.localeCompare(b.opt.crop.displayName)
  );

  // With nothing typed and seed on hand, the list is just the seed.
  const cropLimit = !q && seedRows.length > 0 ? 0 : limit;
  return {
    seeds: seedRows.map((r) => r.opt),
    crops: cropRows.slice(0, cropLimit).map((r) => r.opt),
    moreCrops: Math.max(0, cropRows.length - cropLimit)
  };
}

export function optionLabel(opt: PickerOption): string {
  return opt.kind === 'seed' ? (opt.seed.shortName ?? opt.seed.displayName) : opt.crop.displayName;
}

/** Planting units that can be subtracted from stock held in `stockUnit`. */
export function unitsCompatibleWith(stockUnit: StockUnit): StockUnit[] {
  return PLANTING_UNITS.map((u) => u.value).filter((u) => convert(1, u, stockUnit) !== null);
}

/** The planted amount expressed in the stock's unit, or null when the two
 *  can't be compared (seeds vs lb). */
export function amountInStockUnit(
  amount: number,
  unit: StockUnit,
  stockUnit: StockUnit
): number | null {
  return convert(amount, unit, stockUnit);
}
