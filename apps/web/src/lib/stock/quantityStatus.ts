/**
 * #475: a lot's quantity is `existing` (on hand), `ordered` (bought, not
 * received) or `planned` (not bought yet). Only `existing` counts toward
 * on-hand; the planner sums all three so a farmer can lay out beds before
 * the seed arrives.
 */

import { t, type MessageKey } from '$lib/i18n';

export const QUANTITY_STATUSES = ['existing', 'ordered', 'planned'] as const;
export type QuantityStatus = (typeof QUANTITY_STATUSES)[number];

export const QUANTITY_STATUS_LABELS: Record<QuantityStatus, string> = {
  existing: 'On hand',
  ordered: 'Ordered',
  planned: 'Planned'
};

export interface LotQuantityLike {
  quantityStatus: QuantityStatus;
  balance: number;
  receivedQuantity: number;
}

export type QuantityTotals = Record<QuantityStatus, number>;

/** What a lot still offers. On hand is the ledger balance. An ordered or
 *  planned lot has no receipt yet, so its balance is only what plantings set
 *  aside from it; what is left is the expected quantity less that. */
export function lotAvailable(lot: LotQuantityLike): number {
  if (lot.quantityStatus === 'existing') return lot.balance;
  return Math.max(0, lot.receivedQuantity + lot.balance);
}

export function lotQuantityTotals(lots: ReadonlyArray<LotQuantityLike>): QuantityTotals {
  const totals: QuantityTotals = { existing: 0, ordered: 0, planned: 0 };
  for (const lot of lots) {
    totals[lot.quantityStatus] += lotAvailable(lot);
  }
  return totals;
}

/** Which statuses make up a planning total, largest first, for a row label
 *  such as "12 on hand + 50 ordered". Zero parts are left out. */
export function quantityParts(
  totals: QuantityTotals
): Array<{ status: QuantityStatus; amount: number }> {
  return QUANTITY_STATUSES.filter((s) => totals[s] > 0).map((s) => ({
    status: s,
    amount: totals[s]
  }));
}

function unitWord(amount: number, unit: string, locale?: string | null): string {
  if (unit === 'seeds' || unit === 'count') {
    if (!locale) return amount === 1 ? 'seed' : 'seeds';
    return t(locale, 'wizard.qty.seeds', { count: amount });
  }
  if (unit === 'plants') {
    if (!locale) return amount === 1 ? 'plant' : 'plants';
    return t(locale, 'wizard.qty.plants', { count: amount });
  }
  if (unit === 'packets') {
    if (!locale) return amount === 1 ? 'packet' : 'packets';
    return t(locale, 'wizard.qty.packets', { count: amount });
  }
  return unit;
}

function fmtAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

const STATUS_KEYS: Record<QuantityStatus, MessageKey> = {
  existing: 'wizard.qty.status.existing',
  ordered: 'wizard.qty.status.ordered',
  planned: 'wizard.qty.status.planned'
};

/** A seed row's available quantity in words, unit next to each number:
 *  "12 seeds on hand" or "5 seeds on hand + 50 seeds ordered". */
export function availableQuantityText(
  totals: QuantityTotals,
  unit: string,
  locale?: string | null
): string {
  const parts = quantityParts(totals);
  if (parts.length === 0) return t(locale, 'wizard.qty.notCounted');
  return parts
    .map((p) =>
      t(locale, 'wizard.qty.part', {
        amount: fmtAmount(p.amount),
        unit: unitWord(p.amount, unit, locale),
        status: locale
          ? t(locale, STATUS_KEYS[p.status])
          : QUANTITY_STATUS_LABELS[p.status].toLowerCase()
      })
    )
    .join(' + ');
}
