import { ALL_STOCK_UNITS, convert, type StockUnit } from '$lib/stock/units';

/** Rate units the fertility form offers, each per acre (#739). */
export const FERTILITY_RATE_UNITS = [
  'lb-per-acre',
  'oz-per-acre',
  'gal-per-acre',
  'qt-per-acre',
  'pt-per-acre',
  'fl-oz-per-acre'
] as const;
export type FertilityRateUnit = (typeof FERTILITY_RATE_UNITS)[number];

/** A stored nutrient the farmer did not give and no analysis supplied (#738). */
export const UNKNOWN_NUTRIENT_HUNDREDTHS = -1;

export function nutrientToStorage(v: number | null | undefined): number {
  return v === null || v === undefined || !Number.isFinite(v)
    ? UNKNOWN_NUTRIENT_HUNDREDTHS
    : Math.round(v * 100);
}

export function nutrientFromStorage(hundredths: number): number | null {
  return hundredths < 0 ? null : hundredths / 100;
}

/** The stock unit under a per-acre rate unit. `ratePerAcre` is always per
 *  acre, so a bare stock unit ("lb") reads the same as "lb-per-acre". */
export function rateBaseUnit(rateUnit: string): StockUnit | null {
  const base = rateUnit.trim().replace(/-per-acre$/, '');
  return (ALL_STOCK_UNITS as readonly string[]).includes(base) ? (base as StockUnit) : null;
}

/** What one application put on the block, in a stock unit; null when the
 *  unit isn't a stock unit or the block has no size. */
export function appliedAmount(
  ratePerAcre: number,
  rateUnit: string,
  acres: number | null | undefined
): { amount: number; unit: StockUnit } | null {
  const unit = rateBaseUnit(rateUnit);
  if (!unit || !Number.isFinite(ratePerAcre) || ratePerAcre <= 0) return null;
  if (acres === null || acres === undefined || !(acres > 0)) return null;
  return { amount: Math.round(ratePerAcre * acres * 100) / 100, unit };
}

export interface Analysis {
  n: number;
  p: number;
  k: number;
}

export interface NutrientsPerAcre {
  n: number;
  p: number;
  k: number;
}

/** N, P₂O₅ and K₂O in lb per acre from a guaranteed analysis (percent by
 *  weight). Only a weight rate can be worked out; a volume rate needs the
 *  product's density, which is not on file. */
export function nutrientsFromAnalysis(
  ratePerAcre: number | null | undefined,
  rateUnit: string,
  analysis: Analysis | null | undefined
): NutrientsPerAcre | null {
  if (!analysis || ratePerAcre === null || ratePerAcre === undefined) return null;
  if (!Number.isFinite(ratePerAcre) || ratePerAcre < 0) return null;
  const unit = rateBaseUnit(rateUnit);
  const lb = unit ? convert(ratePerAcre, unit, 'lb') : null;
  if (lb === null) return null;
  const part = (pct: number) => Math.round(((lb * pct) / 100) * 100) / 100;
  return { n: part(analysis.n), p: part(analysis.p), k: part(analysis.k) };
}
