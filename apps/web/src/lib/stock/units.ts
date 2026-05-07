/**
 * Unit conversion + integer-hundredths storage for stock quantities.
 *
 * Why hundredths: SQLite integers avoid floating-point drift across
 * receipt → consumption → adjustment cycles. 1.50 fl-oz is stored as 150;
 * round-trips through the API as a decimal.
 */

export type LiquidUnit = 'fl-oz' | 'pt' | 'qt' | 'gal';
export type SolidUnit = 'oz' | 'lb' | 'kg' | 'g';
export type CountUnit = 'count' | 'bag-50lb' | 'bag-25kg';
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
