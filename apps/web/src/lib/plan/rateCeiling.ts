import { ALL_STOCK_UNITS, convert, type StockUnit } from '$lib/stock/units';

export type RateCeilingProblem = 'not-positive' | 'unit' | 'over';

function asUnit(u: string): StockUnit | null {
  const unit = u.trim().replace(/-per-acre$/, '');
  return (ALL_STOCK_UNITS as readonly string[]).includes(unit) ? (unit as StockUnit) : null;
}

/** Checks a per-acre rate against the label ceiling in the ceiling's own
 *  unit. A rate in a unit that cannot be converted to the label's (or an
 *  unknown unit) is refused, so "2 qt" never passes a "32 fl-oz" ceiling
 *  by comparing the bare numbers. A missing rate unit is read as the
 *  label's unit. */
export function rateCeilingProblem(
  rateAmount: number,
  rateUnit: string | null | undefined,
  ceiling: { amount: number; unit?: string | null }
): RateCeilingProblem | null {
  if (!Number.isFinite(rateAmount) || rateAmount <= 0) return 'not-positive';
  let inCeilingUnit = rateAmount;
  if (rateUnit && ceiling.unit && rateUnit !== ceiling.unit) {
    const from = asUnit(rateUnit);
    const to = asUnit(ceiling.unit);
    const converted = from && to ? convert(rateAmount, from, to) : null;
    if (converted === null) return 'unit';
    inCeilingUnit = converted;
  }
  return inCeilingUnit > ceiling.amount + 1e-9 ? 'over' : null;
}

/** True when the rate equals `rate` once converted to its unit. A typical
 *  (fallback) herbicide rate is never a legal maximum, so a plan may only
 *  repeat it, not tune below or above it (#737 swarm 2026-10-07). */
export function rateMatches(
  rateAmount: number,
  rateUnit: string | null | undefined,
  rate: { amount: number; unit?: string | null }
): boolean {
  if (!Number.isFinite(rateAmount) || rateAmount <= 0) return false;
  let inUnit = rateAmount;
  if (rateUnit && rate.unit && rateUnit !== rate.unit) {
    const from = asUnit(rateUnit);
    const to = asUnit(rate.unit);
    const converted = from && to ? convert(rateAmount, from, to) : null;
    if (converted === null) return false;
    inUnit = converted;
  }
  return Math.abs(inUnit - rate.amount) <= 1e-6 * Math.max(1, rate.amount);
}
