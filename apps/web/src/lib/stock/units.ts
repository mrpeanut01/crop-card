/**
 * Unit conversion + integer-hundredths storage for stock quantities.
 *
 * Why hundredths: SQLite integers avoid floating-point drift across
 * receipt → consumption → adjustment cycles. 1.50 fl-oz is stored as 150;
 * round-trips through the API as a decimal.
 */

import { DEFAULT_PREFS, type Prefs } from '$lib/prefs';
import { numberToLocaleString } from '$lib/intlCache';
import { t, type MessageKey } from '$lib/i18n';

export type LiquidUnit = 'ml' | 'fl-oz' | 'pt' | 'qt' | 'gal';
export type SolidUnit = 'oz' | 'lb' | 'kg' | 'g';
/** Discrete-count units. `seeds` is a 1:1 plant equivalent for the
 *  AllocationWizard + SeedQuantityModal seed-math; it isn't convertible to
 *  any weight or volume unit. `count` covers transplants, plugs, packets
 *  with a labelled count, and any other "discrete plantable item." */
export type CountUnit = 'count' | 'seeds' | 'plants' | 'bag' | 'bag-50lb' | 'bag-25kg' | 'bale';
/** Bulk volume for compost, manure and mulch (#687). Never converted to a
 *  weight: that needs a bulk density, which is not on file. */
export type BulkVolumeUnit = 'yd3' | 'ft3';
export type StockUnit = LiquidUnit | SolidUnit | CountUnit | BulkVolumeUnit;

export const ALL_STOCK_UNITS: ReadonlyArray<StockUnit> = [
  'fl-oz',
  'pt',
  'qt',
  'gal',
  'ml',
  'oz',
  'lb',
  'kg',
  'g',
  'count',
  'seeds',
  'plants',
  'bag',
  'bag-50lb',
  'bag-25kg',
  'bale',
  'yd3',
  'ft3'
];

const SEED_OR_FEED_ONLY: ReadonlySet<StockUnit> = new Set(['seeds', 'plants', 'bag', 'bale']);
const BULK_VOLUME: ReadonlySet<StockUnit> = new Set(['yd3', 'ft3']);

/** Units the pesticide and fertility forms offer. Seed counts, plants, feed
 *  bags and bales belong to their own types; bulk volume (cubic yards and
 *  feet) is for fertility stock such as compost and manure (#687). */
export function inputStockUnits(type: 'pesticide' | 'fertility'): StockUnit[] {
  return ALL_STOCK_UNITS.filter(
    (u) => !SEED_OR_FEED_ONLY.has(u) && (type === 'fertility' || !BULK_VOLUME.has(u))
  );
}

const LIQUID_FL_OZ_PER_UNIT: Record<LiquidUnit, number> = {
  ml: 1 / 29.5735295625,
  'fl-oz': 1,
  pt: 16,
  qt: 32,
  gal: 128
};

const MASS_GRAMS_PER_UNIT: Record<SolidUnit, number> = {
  g: 1,
  oz: 28.3495,
  lb: 453.592,
  kg: 1000
};

const BULK_FT3_PER_UNIT: Record<BulkVolumeUnit, number> = {
  ft3: 1,
  yd3: 27
};

function isLiquid(u: StockUnit): u is LiquidUnit {
  return u === 'ml' || u === 'fl-oz' || u === 'pt' || u === 'qt' || u === 'gal';
}
function isSolid(u: StockUnit): u is SolidUnit {
  return u === 'g' || u === 'oz' || u === 'lb' || u === 'kg';
}
function isBulkVolume(u: StockUnit): u is BulkVolumeUnit {
  return u === 'yd3' || u === 'ft3';
}
/** A plant on a planting and a plant in seed stock are the same thing; the
 *  planting form's "plants" unit is stored as 'count' (#719). */
function isPlantCount(u: StockUnit): boolean {
  return u === 'plants' || u === 'count';
}

/**
 * Convert `amount` from `from` unit to `to` unit. Returns null if the units
 * are incompatible (e.g., gal → lb, fl-oz → count).
 */
export function convert(amount: number, from: StockUnit, to: StockUnit): number | null {
  if (from === to) return amount;
  if (isLiquid(from) && isLiquid(to)) {
    return (amount * LIQUID_FL_OZ_PER_UNIT[from]) / LIQUID_FL_OZ_PER_UNIT[to];
  }
  if (isSolid(from) && isSolid(to)) {
    return (amount * MASS_GRAMS_PER_UNIT[from]) / MASS_GRAMS_PER_UNIT[to];
  }
  if (isBulkVolume(from) && isBulkVolume(to)) {
    return (amount * BULK_FT3_PER_UNIT[from]) / BULK_FT3_PER_UNIT[to];
  }
  if (isPlantCount(from) && isPlantCount(to)) return amount;
  return null;
}

export function toHundredths(amount: number): number {
  return Math.round(amount * 100);
}

export function fromHundredths(hundredths: number): number {
  return hundredths / 100;
}

/**
 * Convert a measurement to default-unit hundredths for storage.
 * Returns null if the units are incompatible.
 */
export function toStorage(
  amount: number,
  fromUnit: StockUnit,
  defaultUnit: StockUnit
): number | null {
  const converted = convert(amount, fromUnit, defaultUnit);
  if (converted === null) return null;
  return toHundredths(converted);
}

const ML_PER_FL_OZ = 29.5735295625;
const M3_PER_FT3 = 0.028316846592;
const GRAMS_PER_OZ = 28.349523125;

const num = (v: number, digits: number) =>
  numberToLocaleString(v, 'en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

function metricEquivalent(amount: number, unit: StockUnit): string | null {
  if (isLiquid(unit)) {
    const ml = amount * LIQUID_FL_OZ_PER_UNIT[unit] * ML_PER_FL_OZ;
    return Math.abs(ml) < 1000 ? `${num(ml, 0)} mL` : `${num(ml / 1000, 1)} L`;
  }
  if (unit === 'lb' || unit === 'oz') {
    const g = amount * (unit === 'lb' ? 16 : 1) * GRAMS_PER_OZ;
    return Math.abs(g) < 1000 ? `${num(g, 0)} g` : `${num(g / 1000, 1)} kg`;
  }
  if (isBulkVolume(unit)) return `${num(amount * BULK_FT3_PER_UNIT[unit] * M3_PER_FT3, 2)} m³`;
  return null;
}

export interface StockDisplayOpts {
  digits?: number;
  /** Pesticide stock is shown in its label unit, metric alongside. */
  labelUnit?: boolean;
  /** Stock category. Seed counts ('count' or 'seeds') read as seeds. */
  category?: string | null;
  /** UI locale for the "seeds" / "bags" words; overrides `prefs.locale`. */
  locale?: string | null;
}

/** Units offered for seed (#473): a seed count first, then plants for
 *  crowns, bare-root trees, bushes and transplants (#719), then weights for
 *  bulk seed bought by the ounce or pound. No weight-to-count conversion. */
export const SEED_UNITS: ReadonlyArray<StockUnit> = ['seeds', 'plants', 'oz', 'lb', 'g'];

/** Seeds are counted in 'seeds'; older seed rows use 'count' for the same thing. */
export function isSeedCountUnit(unit: string, category: string | null | undefined): boolean {
  return category === 'seed' && (unit === 'seeds' || unit === 'count');
}

const UNIT_LABELS: Record<StockUnit, string> = {
  ml: 'mL',
  'fl-oz': 'fl oz',
  pt: 'pt',
  qt: 'qt',
  gal: 'gal',
  oz: 'oz',
  lb: 'lb',
  kg: 'kg',
  g: 'g',
  count: 'Count',
  seeds: 'Seeds',
  plants: 'Plants',
  bag: 'Bag',
  'bag-50lb': '50 lb bag',
  'bag-25kg': '25 kg bag',
  bale: 'Bale',
  yd3: 'yd³',
  ft3: 'ft³'
};

const UNIT_LABEL_KEYS: Partial<Record<StockUnit, MessageKey>> = {
  count: 'units.label.count',
  seeds: 'units.label.seeds',
  plants: 'units.label.plants',
  yd3: 'units.label.yd3',
  ft3: 'units.label.ft3',
  bag: 'units.label.bag',
  'bag-50lb': 'units.label.bag50lb',
  'bag-25kg': 'units.label.bag25kg',
  bale: 'units.label.bale'
};

/** Human label for a unit picker. For seed, 'count' reads as Seeds too. */
export function stockUnitLabel(
  unit: StockUnit,
  category?: string | null,
  locale?: string | null
): string {
  if (isSeedCountUnit(unit, category)) return t(locale, 'units.label.seeds');
  const key = UNIT_LABEL_KEYS[unit];
  if (key) return t(locale, key);
  return UNIT_LABELS[unit] ?? unit;
}

/** A stored stock quantity for display. US users see it as stored
 *  ("12.0 gal"). Metric users see plain weights/volumes converted
 *  ("45.4 L"), or, for label-unit stock, "12.0 gal (45.4 L)". Counts,
 *  bags and already-metric units are never converted. */
export function formatStockQuantity(
  amount: number | null | undefined,
  unit: StockUnit | string,
  prefs: Pick<Prefs, 'units' | 'locale'> = DEFAULT_PREFS,
  opts: StockDisplayOpts = {}
): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  const locale = opts.locale ?? prefs.locale;
  if (isSeedCountUnit(unit, opts.category)) {
    return t(locale, Math.abs(amount) === 1 ? 'units.qty.seeds.one' : 'units.qty.seeds.other', {
      n: num(amount, 0)
    });
  }
  if (unit === 'bag') {
    return t(locale, Math.abs(amount) === 1 ? 'units.qty.bags.one' : 'units.qty.bags.other', {
      n: num(amount, opts.digits ?? 2)
    });
  }
  if (unit === 'bale') {
    return t(locale, Math.abs(amount) === 1 ? 'units.qty.bales.one' : 'units.qty.bales.other', {
      n: num(amount, opts.digits ?? 2)
    });
  }
  if (unit === 'plants') {
    return t(locale, Math.abs(amount) === 1 ? 'units.qty.plants.one' : 'units.qty.plants.other', {
      n: num(amount, opts.digits ?? 0)
    });
  }
  const shown = unit === 'yd3' || unit === 'ft3' ? UNIT_LABELS[unit] : unit;
  const us = `${opts.digits === undefined ? amount.toFixed(1) : num(amount, opts.digits)} ${shown}`;
  if (prefs.units !== 'metric') return us;
  const metric = (ALL_STOCK_UNITS as ReadonlyArray<string>).includes(unit)
    ? metricEquivalent(amount, unit as StockUnit)
    : null;
  if (!metric) return us;
  return opts.labelUnit ? `${us} (${metric})` : metric;
}

const PESTICIDE_CATEGORIES = new Set(['herbicide', 'insecticide', 'fungicide', 'pesticide']);

export function isLabelUnitCategory(category: string | null | undefined): boolean {
  return !!category && PESTICIDE_CATEGORIES.has(category);
}

const ACRES_PER_HA = 2.471053814671653;
const PER_AREA = /^\s*(fl[\s-]?oz|pt|qt|gal|oz|lb)s?\s*(?:\/|-per-|\s+per\s+)\s*(?:ac|acre|a)\s*$/i;

/** A label rate unit code as a per-acre unit ("fl-oz" → "fl oz/acre"). */
export function perAcreRateUnit(unit: string): string {
  return `${unit === 'fl-oz' ? 'fl oz' : unit}/acre`;
}

/** A per-acre rate whose unit is free text ("22 fl oz/ac", "150 lb/acre").
 *  Label rates keep the label unit first; other rates convert outright.
 *  Units that aren't a plain weight or volume per acre stay as written. */
export function formatRateText(
  amount: number | null | undefined,
  unit: string,
  prefs: Pick<Prefs, 'units'> = DEFAULT_PREFS,
  opts: { labelUnit?: boolean } = {}
): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  const us = `${amount} ${unit}`;
  if (prefs.units !== 'metric') return us;
  const m = PER_AREA.exec(unit);
  if (!m) return us;
  const base = m[1].toLowerCase().replace(/^fl[\s-]?oz$/, 'fl-oz') as StockUnit;
  const perHa = metricEquivalent(amount * ACRES_PER_HA, base);
  if (!perHa) return us;
  return opts.labelUnit ? `${us} (${perHa}/ha)` : `${perHa}/ha`;
}
