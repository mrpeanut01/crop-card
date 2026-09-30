/** Plain-English money lines shared by /finance and the Profit Card. */

import { formatMoney } from './money';
import type { EnterpriseProfit, SeasonProfit } from './profit';

/** "45 min", "1.5 h": to the nearest quarter hour above an hour. Mirrors
 *  `formatHours` in `lib/labour/hours.ts` (F1-18). */
export function formatMinutes(minutes: number): string {
  if (minutes <= 60) return `${Math.round(minutes)} min`;
  const hours = Math.round((minutes / 60) * 4) / 4;
  return `${Number.isInteger(hours) ? hours : String(hours)} h`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function inputCostText(
  e: Pick<EnterpriseProfit, 'inputCostCents' | 'inputCostUnknownCount'>
): string {
  const known = formatMoney(e.inputCostCents);
  if (e.inputCostUnknownCount === 0) return known;
  const unknown = plural(e.inputCostUnknownCount, 'use', 'uses');
  return e.inputCostCents === 0
    ? `Cost unknown (${unknown})`
    : `${known}, plus ${unknown} with unknown cost`;
}

export function netLabel(e: Pick<EnterpriseProfit, 'inputCostUnknownCount'>): string {
  return e.inputCostUnknownCount > 0
    ? `Net, not counting ${plural(e.inputCostUnknownCount, 'use', 'uses')} with unknown cost`
    : 'Net';
}

export function labourText(
  e: Pick<EnterpriseProfit, 'labourMinutes' | 'labourCents' | 'labourNotCounted'>,
  rate: number | null
): string {
  if (e.labourNotCounted) return 'Labour not counted for animals';
  if (e.labourMinutes === 0) return 'No time logged';
  const hours = formatMinutes(e.labourMinutes);
  if (rate === null || e.labourCents === null) return `${hours}. Labour rate not set`;
  return `${hours}, ${formatMoney(e.labourCents)}. Labour, an estimate at ${formatMoney(rate)} an hour`;
}

export function hasUnallocated(p: SeasonProfit): boolean {
  const u = p.unallocated;
  return (
    u.incomeCents !== 0 ||
    u.directExpenseCents !== 0 ||
    u.inputCostCents !== 0 ||
    u.inputCostUnknownCount !== 0 ||
    u.labourMinutes !== 0
  );
}
