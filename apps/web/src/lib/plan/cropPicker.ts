import { t, type TranslateKey } from '$lib/i18n';
import { convert, type StockUnit } from '$lib/stock/units';
import { cropDisplayName } from '$lib/i18n/cropName';

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
  onOrder?: number;
  planned?: number;
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

const UNIT_KEY: Partial<Record<string, TranslateKey>> = {
  seeds: 'plantui.unit.seeds',
  count: 'plantui.unit.plants'
};

export function unitLabel(unit: string, locale?: string | null): string {
  const key = UNIT_KEY[unit];
  if (locale && key) return t(locale, key);
  return PLANTING_UNITS.find((u) => u.value === unit)?.label ?? unit;
}

/** The planting units with labels in `locale`. */
export function plantingUnits(
  locale?: string | null
): ReadonlyArray<{ value: StockUnit; label: string }> {
  return PLANTING_UNITS.map((u) => ({ value: u.value, label: unitLabel(u.value, locale) }));
}

/** A stored planting amount's unit for display: English keeps the raw
 *  unit; another language names seeds and plants in that language. */
export function quantityUnitLabel(unit: string, locale?: string | null): string {
  return locale && locale !== 'en' ? unitLabel(unit, locale) : unit;
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

/** Everything the seed can still cover: on hand plus ordered plus planned
 *  (#475). Planting draws on hand first, then what is expected. */
export function seedAvailable(seed: PickerSeed): number {
  return Math.max(0, seed.onHand) + Math.max(0, seed.onOrder ?? 0) + Math.max(0, seed.planned ?? 0);
}

/** The farm's own seed first, whether it is on hand, ordered, planned or not
 *  counted yet (#475), then the rest of the catalog. A crop with a seed
 *  lot is listed only under its seed. */
export function searchCrops(
  query: string,
  seeds: ReadonlyArray<PickerSeed>,
  catalog: ReadonlyArray<PickerCrop>,
  limit = 8,
  locale?: string | null
): PickerResults {
  const q = query.trim().toLowerCase();
  const byId = new Map(catalog.map((c) => [c.pluginId, c]));

  const seedRows: Array<{ opt: Extract<PickerOption, { kind: 'seed' }>; s: number }> = [];
  const seededIds = new Set<string>();
  for (const seed of seeds) {
    if (!seed.cropPluginId) continue;
    const crop = byId.get(seed.cropPluginId);
    if (!crop) continue;
    seededIds.add(crop.pluginId);
    const s = q
      ? score(
          [
            seed.shortName,
            seed.displayName,
            crop.displayName,
            crop.cropFamily,
            localName(crop, locale)
          ],
          q
        )
      : 0;
    if (s >= 0) seedRows.push({ opt: { kind: 'seed', seed, crop }, s });
  }
  seedRows.sort(
    (a, b) =>
      b.s - a.s ||
      Number(seedAvailable(b.opt.seed) > 0) - Number(seedAvailable(a.opt.seed) > 0) ||
      (a.opt.seed.shortName ?? a.opt.seed.displayName).localeCompare(
        b.opt.seed.shortName ?? b.opt.seed.displayName
      )
  );

  const cropRows: Array<{ opt: Extract<PickerOption, { kind: 'crop' }>; s: number }> = [];
  for (const crop of catalog) {
    if (seededIds.has(crop.pluginId)) continue;
    const s = q ? score([crop.displayName, crop.cropFamily, localName(crop, locale)], q) : 0;
    if (s >= 0) cropRows.push({ opt: { kind: 'crop', crop }, s });
  }
  cropRows.sort(
    (a, b) => b.s - a.s || a.opt.crop.displayName.localeCompare(b.opt.crop.displayName)
  );

  // With nothing typed and seed in inventory, the list is just the seed.
  const cropLimit = !q && seedRows.length > 0 ? 0 : limit;
  return {
    seeds: seedRows.map((r) => r.opt),
    crops: cropRows.slice(0, cropLimit).map((r) => r.opt),
    moreCrops: Math.max(0, cropRows.length - cropLimit)
  };
}

function localName(crop: PickerCrop, locale?: string | null): string | null {
  const name = cropDisplayName(crop.pluginId, crop.displayName, locale);
  return name === crop.displayName ? null : name;
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
