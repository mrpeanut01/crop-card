/**
 * #555: how a crop takes up space. Pure and client-safe.
 *
 * - `in-row`: the plugin has an in-row spacing; plants are counted.
 * - `area`: the plugin has a sourced `plantingGuide.seedingRate` and no
 *   in-row spacing. The crop is sown across ground (drilled or broadcast),
 *   so there is no plant count; seed is measured per area from the
 *   source's printed range.
 * - `tree`: no in-row spacing but a sourced `treeSizeClasses` table (#548).
 *   Trees are spaced by the planting's size class (`plugin`); with no
 *   class (or one the table lacks) the widest class is used, tagged
 *   `fallback`, so capacity is never overstated.
 * - `unknown`: none of these. Consumers keep the tagged `FALLBACK_SPACING_IN`.
 *
 * Only `seedingRate` drives area math. The unsourced legacy
 * `plantingGuide.seedsPerAcre`, `recommendedLbsPerAcre` and `seedsPerLb`
 * never do.
 *
 * Panel rulings (docs/design/GARDEN_DESIGNER.md, "Area mode"): seed on hand
 * sizes its area at the high end of the rate range (AM-1); a weight of seed
 * against a seed-count rate is not known (AM-2); a crop with one method's
 * rate uses it, labelled with that method (AM-3); amounts under 1 lb read
 * in ounces, rounded outward (AM-4); engine units are square feet (AM-5).
 */

import { numberToLocaleString } from '$lib/intlCache';

export const SQFT_PER_ACRE = 43_560;

/** In the layout engine an area crop's "plant" is one square foot. */
export const AREA_UNIT_SQFT = 1;

export type SowMethod = 'broadcast' | 'drilled' | 'planted';

export interface MinMax {
  min: number;
  max: number;
}

export interface SeedingRateFields {
  drilledLbsPerAcre?: MinMax;
  broadcastLbsPerAcre?: MinMax;
  drilledSeedsPerSqFt?: MinMax;
  seedsPerAcre?: MinMax;
  drillRowSpacingIn?: MinMax;
  seedBasis?: 'bulk' | 'pls';
}

export const TREE_SIZE_CLASSES = ['dwarf', 'semi-dwarf', 'standard'] as const;
export type TreeSizeClass = (typeof TREE_SIZE_CLASSES)[number];

export function isTreeSizeClass(v: unknown): v is TreeSizeClass {
  return typeof v === 'string' && (TREE_SIZE_CLASSES as readonly string[]).includes(v);
}

/** #555 leftover: the sowing method saved on a planting. `planted` (a
 *  population rate) is never a choice, so it is not stored. */
export const SAVED_SOW_METHODS = ['drilled', 'broadcast'] as const;
export type SavedSowMethod = (typeof SAVED_SOW_METHODS)[number];

export function isSavedSowMethod(v: unknown): v is SavedSowMethod {
  return typeof v === 'string' && (SAVED_SOW_METHODS as readonly string[]).includes(v);
}

export interface TreeSizeRow {
  sizeClass: TreeSizeClass;
  minSpacingFt: number;
  yearsToBearing: MinMax;
}

export interface SpacingCropFields {
  defaultRowSpacingInches?: number | null;
  treeSizeClasses?: readonly TreeSizeRow[] | null;
  plantingGuide?: {
    rowSpacingIn?: number | null;
    inRowSpacingIn?: MinMax | null;
    seedingRate?: SeedingRateFields | null;
  } | null;
}

/** One method's sourced rate. Exactly one of the three per-area fields is
 *  set. */
export interface AreaRate {
  method: SowMethod;
  lbPerAcre?: MinMax;
  seedsPerSqFt?: MinMax;
  seedsPerAcre?: MinMax;
}

export type SpacingModel =
  | { kind: 'in-row'; inRowIn: MinMax; rowIn: number | null }
  | {
      kind: 'area';
      /** Methods with a sourced rate, Broadcast first. Empty when the
       *  plugin only gives a drill row width: the amount is not known. */
      rates: AreaRate[];
      drillRowIn?: MinMax;
      seedBasis?: 'bulk' | 'pls';
    }
  | {
      kind: 'tree';
      /** The plugin's rows, smallest tree first. */
      classes: TreeSizeRow[];
      /** The row spacing and counts use: the planting's class, else the
       *  widest one. */
      row: TreeSizeRow;
      /** True when `row` is the planting's own size class. */
      known: boolean;
      /** Minimum distance between trees, in inches. */
      spacingIn: number;
      provenance: 'plugin' | 'fallback';
    }
  | { kind: 'unknown' };

function positive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function range(r: MinMax | null | undefined): MinMax | undefined {
  if (!r || !Number.isFinite(r.min) || !Number.isFinite(r.max) || r.max <= 0) return undefined;
  return { min: Math.max(0, Math.min(r.min, r.max)), max: Math.max(r.min, r.max) };
}

const TREE_ORDER: Record<TreeSizeClass, number> = { dwarf: 0, 'semi-dwarf': 1, standard: 2 };

/** The plugin's usable tree size rows, smallest tree first. */
export function treeSizeRows(
  crop: Pick<SpacingCropFields, 'treeSizeClasses'> | null | undefined
): TreeSizeRow[] {
  return (crop?.treeSizeClasses ?? [])
    .filter((r) => isTreeSizeClass(r.sizeClass) && positive(r.minSpacingFt))
    .slice()
    .sort((a, b) => TREE_ORDER[a.sizeClass] - TREE_ORDER[b.sizeClass]);
}

function treeModel(classes: TreeSizeRow[], treeSizeClass: string | null | undefined): SpacingModel {
  const chosen = classes.find((r) => r.sizeClass === treeSizeClass);
  const widest = classes.reduce((a, b) => (b.minSpacingFt > a.minSpacingFt ? b : a));
  const row = chosen ?? widest;
  return {
    kind: 'tree',
    classes,
    row,
    known: !!chosen,
    spacingIn: row.minSpacingFt * 12,
    provenance: chosen ? 'plugin' : 'fallback'
  };
}

/** `treeSizeClass` is the planting's answer to "Tree size" (#548); it only
 *  matters for a crop with a `treeSizeClasses` table. */
export function spacingModel(
  crop: SpacingCropFields | null | undefined,
  treeSizeClass?: string | null
): SpacingModel {
  const guide = crop?.plantingGuide ?? undefined;
  const inRow = range(guide?.inRowSpacingIn);
  if (inRow && (inRow.min + inRow.max) / 2 > 0) {
    const row = guide?.rowSpacingIn ?? crop?.defaultRowSpacingInches;
    return { kind: 'in-row', inRowIn: inRow, rowIn: positive(row) ? row : null };
  }
  const trees = treeSizeRows(crop);
  if (trees.length > 0) return treeModel(trees, treeSizeClass);
  const rate = guide?.seedingRate;
  if (!rate) return { kind: 'unknown' };
  const rates: AreaRate[] = [];
  const broadcast = range(rate.broadcastLbsPerAcre);
  if (broadcast && broadcast.min > 0) rates.push({ method: 'broadcast', lbPerAcre: broadcast });
  const drilledLb = range(rate.drilledLbsPerAcre);
  const drilledSeeds = range(rate.drilledSeedsPerSqFt);
  if (drilledLb && drilledLb.min > 0) rates.push({ method: 'drilled', lbPerAcre: drilledLb });
  else if (drilledSeeds && drilledSeeds.min > 0)
    rates.push({ method: 'drilled', seedsPerSqFt: drilledSeeds });
  const population = range(rate.seedsPerAcre);
  if (population && population.min > 0) rates.push({ method: 'planted', seedsPerAcre: population });
  const drillRowIn = range(rate.drillRowSpacingIn);
  return {
    kind: 'area',
    rates,
    ...(drillRowIn ? { drillRowIn } : {}),
    ...(rate.seedBasis ? { seedBasis: rate.seedBasis } : {})
  };
}

export function isAreaCrop(crop: SpacingCropFields | null | undefined): boolean {
  return spacingModel(crop).kind === 'area';
}

/** Methods the farmer can choose between; the toggle shows only for two. */
export function sowMethods(model: SpacingModel): SowMethod[] {
  return model.kind === 'area' ? model.rates.map((r) => r.method) : [];
}

/** Broadcast when the plugin has a broadcast rate (most gardens have no
 *  drill), else the one method it has. */
export function defaultSowMethod(model: SpacingModel): SowMethod | null {
  return sowMethods(model)[0] ?? null;
}

/** The method a planting is sown by: its saved one when the plugin has a
 *  rate for it, else the default (#555 leftover). */
export function plantingSowMethod(
  model: SpacingModel,
  saved: string | null | undefined
): SowMethod | null {
  if (
    model.kind === 'area' &&
    isSavedSowMethod(saved) &&
    model.rates.some((r) => r.method === saved)
  )
    return saved;
  return defaultSowMethod(model);
}

/** The sourced rate for a method; an unknown or missing method falls back
 *  to the default one (AM-3), never to another method's number under the
 *  wrong label: the result names its own method. */
export function areaRate(model: SpacingModel, method?: SowMethod | null): AreaRate | null {
  if (model.kind !== 'area' || model.rates.length === 0) return null;
  return model.rates.find((r) => r.method === method) ?? model.rates[0];
}

export type SeedUnitLike = string;

const LB_PER: Record<string, number> = {
  lb: 1,
  oz: 1 / 16,
  g: 1 / 453.59237,
  kg: 1000 / 453.59237
};

/** Pounds for a weight unit, null for anything else. */
export function toPounds(quantity: number, unit: SeedUnitLike): number | null {
  const k = LB_PER[unit];
  return k === undefined || !Number.isFinite(quantity) ? null : quantity * k;
}

export interface AreaSize {
  sqft: number;
  provenance: 'data' | 'manual';
}

/**
 * Square feet a quantity of seed covers, sized at the high end of the rate
 * (AM-1) so the plan never needs more seed than is on hand. `manualLbPerAcre`
 * (the farmer's own rate) wins and is tagged `manual`. Null when the amount
 * is not known: no rate, or a weight against a seed-count rate (AM-2).
 */
export function areaForSeed(
  model: SpacingModel,
  method: SowMethod | null | undefined,
  quantity: number,
  unit: SeedUnitLike,
  manualLbPerAcre?: number | null
): AreaSize | null {
  if (model.kind !== 'area' || !(quantity > 0)) return null;
  const lb = toPounds(quantity, unit);
  if (positive(manualLbPerAcre)) {
    return lb === null
      ? null
      : { sqft: (lb / manualLbPerAcre) * SQFT_PER_ACRE, provenance: 'manual' };
  }
  const rate = areaRate(model, method);
  if (!rate) return null;
  if (rate.lbPerAcre) {
    return lb === null
      ? null
      : { sqft: (lb / rate.lbPerAcre.max) * SQFT_PER_ACRE, provenance: 'data' };
  }
  const seeds = unit === 'seeds' || unit === 'count' ? quantity : null;
  if (seeds === null) return null;
  if (rate.seedsPerSqFt) return { sqft: seeds / rate.seedsPerSqFt.max, provenance: 'data' };
  if (rate.seedsPerAcre) {
    return { sqft: (seeds / rate.seedsPerAcre.max) * SQFT_PER_ACRE, provenance: 'data' };
  }
  return null;
}

export type SeedAmount =
  | {
      kind: 'weight';
      method: SowMethod;
      lb: MinMax;
      provenance: 'data' | 'manual';
      seedBasis?: 'bulk' | 'pls';
    }
  | { kind: 'seeds'; method: SowMethod; seeds: MinMax; provenance: 'data' };

/** Seed for `sqft` of ground: the rate's range times the area, never a
 *  midpoint. Null when the amount is not known for this crop. */
export function seedAmountFor(
  model: SpacingModel,
  method: SowMethod | null | undefined,
  sqft: number,
  manualLbPerAcre?: number | null
): SeedAmount | null {
  if (model.kind !== 'area' || !(sqft > 0)) return null;
  const acres = sqft / SQFT_PER_ACRE;
  const rate = areaRate(model, method);
  if (positive(manualLbPerAcre)) {
    const lb = manualLbPerAcre * acres;
    return {
      kind: 'weight',
      method: rate?.method ?? method ?? 'broadcast',
      lb: { min: lb, max: lb },
      provenance: 'manual'
    };
  }
  if (!rate) return null;
  if (rate.lbPerAcre) {
    return {
      kind: 'weight',
      method: rate.method,
      lb: { min: rate.lbPerAcre.min * acres, max: rate.lbPerAcre.max * acres },
      provenance: 'data',
      ...(model.seedBasis ? { seedBasis: model.seedBasis } : {})
    };
  }
  if (rate.seedsPerSqFt) {
    return {
      kind: 'seeds',
      method: rate.method,
      seeds: { min: rate.seedsPerSqFt.min * sqft, max: rate.seedsPerSqFt.max * sqft },
      provenance: 'data'
    };
  }
  if (rate.seedsPerAcre) {
    return {
      kind: 'seeds',
      method: rate.method,
      seeds: { min: rate.seedsPerAcre.min * acres, max: rate.seedsPerAcre.max * acres },
      provenance: 'data'
    };
  }
  return null;
}

function fmtNum(n: number, digits: number): string {
  return numberToLocaleString(n, 'en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0
  });
}

function outward(min: number, max: number, digits: number): [string, string] {
  const k = 10 ** digits;
  const a = Math.floor(min * k + 1e-9) / k;
  const b = Math.ceil(max * k - 1e-9) / k;
  return [fmtNum(a, digits), fmtNum(b, digits)];
}

function rangeText(min: number, max: number, digits: number, unit: string): string {
  const [a, b] = outward(min, max, digits);
  const n = a === b ? a : `${a}–${b}`;
  return unit ? `${n} ${unit}` : n;
}

/** "3.2–4.1 lb", "2.6–5.1 oz", "1.4–1.9 kg" or "75–150 g": one unit for
 *  both ends, ounces (grams) when the top is under 1 lb (1 kg), each end
 *  rounded outward so the range never reads narrower than the source. */
export function formatSeedAmount(amount: SeedAmount, units: 'us' | 'metric'): string {
  if (amount.kind === 'seeds') return formatSeedCount(amount);
  const { min, max } = amount.lb;
  if (units === 'metric') {
    const kgMin = min * 0.45359237;
    const kgMax = max * 0.45359237;
    if (kgMax < 1) return rangeText(kgMin * 1000, kgMax * 1000, 0, 'g');
    return rangeText(kgMin, kgMax, kgMax < 10 ? 1 : 0, 'kg');
  }
  if (max < 1) return rangeText(min * 16, max * 16, 1, 'oz');
  return rangeText(min, max, max < 10 ? 1 : 0, 'lb');
}

/** A seed-count range without a unit word ("1,200–1,600"); the caller's
 *  catalog string says "seeds". */
export function formatSeedCount(amount: Extract<SeedAmount, { kind: 'seeds' }>): string {
  return rangeText(amount.seeds.min, amount.seeds.max, 0, '');
}
