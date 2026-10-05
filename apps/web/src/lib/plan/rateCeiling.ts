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
