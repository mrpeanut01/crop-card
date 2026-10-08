import { t } from '$lib/i18n';
import type { Prefs } from '$lib/prefs';
import { formatStockQuantity } from '$lib/stock/units';

type QtyPrefs = Pick<Prefs, 'units' | 'locale'>;

function qty(amount: number, unit: string, category: string, prefs: QtyPrefs): string {
  return formatStockQuantity(amount, unit, prefs, { category, digits: 2 });
}

/** #620: "2 bags on hand (reorder at 3 bags)", with units pluralized and
 *  converted the way the inventory pages show them. */
export function lowStockLine(
  item: { onHand: number; defaultUnit: string; reorderThreshold: number; category: string },
  prefs: QtyPrefs
): string {
  return t(prefs.locale, 'today.stock.lowLine', {
    onHand: qty(item.onHand, item.defaultUnit, item.category, prefs),
    threshold: qty(item.reorderThreshold, item.defaultUnit, item.category, prefs)
  });
}

export function expiringStockLine(
  lot: { balance: number; unit: string; daysUntilExpiry: number; category: string },
  prefs: QtyPrefs
): string {
  return t(prefs.locale, 'today.stock.expiryLine', {
    balance: qty(lot.balance, lot.unit, lot.category, prefs),
    count: lot.daysUntilExpiry
  });
}
