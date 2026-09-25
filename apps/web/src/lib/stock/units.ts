/**
 * Unit conversion + integer-hundredths storage for stock quantities.
 *
 * Why hundredths: SQLite integers avoid floating-point drift across
 * receipt → consumption → adjustment cycles. 1.50 fl-oz is stored as 150;
 * round-trips through the API as a decimal.
 */

import { DEFAULT_PREFS, type Prefs } from '$lib/prefs';

export type LiquidUnit = 'fl-oz' | 'pt' | 'qt' | 'gal';
export type SolidUnit = 'oz' | 'lb' | 'kg' | 'g';
/** Discrete-count units. `seeds` is a 1:1 plant equivalent for the
 *  AllocationWizard + SeedQuantityModal seed-math; it isn't convertible to
 *  any weight or volume unit. `count` covers transplants, plugs, packets
 *  with a labelled count, and any other "discrete plantable item." */
export type CountUnit = 'count' | 'seeds' | 'bag-50lb' | 'bag-25kg';
export type StockUnit = LiquidUnit | SolidUnit | CountUnit;

export const ALL_STOCK_UNITS: ReadonlyArray<StockUnit> = [
  'fl-oz',
  'pt',
  'qt',
  'gal',
  'oz',
  'lb',
  'kg',
  'g',
  'count',
  'seeds',
  'bag-50lb',
  'bag-25kg'
];

const LIQUID_FL_OZ_PER_UNIT: Record<LiquidUnit, number> = {
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

function isLiquid(u: StockUnit): u is LiquidUnit {
  return u === 'fl-oz' || u === 'pt' || u === 'qt' || u === 'gal';
}
function isSolid(u: StockUnit): u is SolidUnit {
  return u === 'g' || u === 'oz' || u === 'lb' || u === 'kg';
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
const GRAMS_PER_OZ = 28.349523125;

const num = (v: number, digits: number) =>
  v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

function metricEquivalent(amount: number, unit: StockUnit): string | null {
  if (isLiquid(unit)) {
    const ml = amount * LIQUID_FL_OZ_PER_UNIT[unit] * ML_PER_FL_OZ;
    return Math.abs(ml) < 1000 ? `${num(ml, 0)} mL` : `${num(ml / 1000, 1)} L`;
  }
  if (unit === 'lb' || unit === 'oz') {
    const g = amount * (unit === 'lb' ? 16 : 1) * GRAMS_PER_OZ;
    return Math.abs(g) < 1000 ? `${num(g, 0)} g` : `${num(g / 1000, 1)} kg`;
  }
  return null;
}

export interface StockDisplayOpts {
  digits?: number;
  /** Pesticide stock is shown in its label unit, metric alongside. */
  labelUnit?: boolean;
}

/** A stored stock quantity for display. US users see it as stored
 *  ("12.0 gal"). Metric users see plain weights/volumes converted
 *  ("45.4 L"), or, for label-unit stock, "12.0 gal (45.4 L)". Counts,
 *  bags and already-metric units are never converted. */
export function formatStockQuantity(
  amount: number | null | undefined,
  unit: StockUnit | string,
  prefs: Pick<Prefs, 'units'> = DEFAULT_PREFS,
  opts: StockDisplayOpts = {}
): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  const us = `${opts.digits === undefined ? amount.toFixed(1) : num(amount, opts.digits)} ${unit}`;
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
