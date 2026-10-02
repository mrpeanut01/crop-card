/** Plain-English money lines shared by /finance and the Profit Card. */

import { formatMoney } from './money';
import type { EnterpriseProfit, SeasonProfit } from './profit';
import { t } from '$lib/i18n';

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

function uses(n: number, locale?: string | null): string {
  return t(locale, 'finance.fmt.uses', { count: n });
}

export function inputCostText(
  e: Pick<EnterpriseProfit, 'inputCostCents' | 'inputCostUnknownCount'>,
  locale?: string | null
): string {
  const known = formatMoney(e.inputCostCents);
  if (e.inputCostUnknownCount === 0) return known;
  const unknown = uses(e.inputCostUnknownCount, locale);
  return e.inputCostCents === 0
    ? t(locale, 'finance.fmt.costUnknown', { unknown })
    : t(locale, 'finance.fmt.plusUnknown', { known, unknown });
}

export function netLabel(
  e: Pick<EnterpriseProfit, 'inputCostUnknownCount'>,
  locale?: string | null
): string {
  return e.inputCostUnknownCount > 0
    ? t(locale, 'finance.fmt.netNotCounting', { unknown: uses(e.inputCostUnknownCount, locale) })
    : t(locale, 'finance.fmt.net');
}

export function labourText(
  e: Pick<EnterpriseProfit, 'labourMinutes' | 'labourCents' | 'labourNotCounted'>,
  rate: number | null,
  locale?: string | null
): string {
  if (e.labourNotCounted) return t(locale, 'finance.fmt.labourAnimals');
  if (e.labourMinutes === 0) return t(locale, 'finance.fmt.noTime');
  const hours = formatMinutes(e.labourMinutes);
  if (rate === null || e.labourCents === null) {
    return t(locale, 'finance.fmt.rateNotSet', { hours });
  }
  return t(locale, 'finance.fmt.labourEstimate', {
    hours,
    cost: formatMoney(e.labourCents),
    rate: formatMoney(rate)
  });
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
