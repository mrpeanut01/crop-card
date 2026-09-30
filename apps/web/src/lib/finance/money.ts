/** Money is USD cents everywhere and shown as "$1,234.56" (F0-10). */

import { numberFormat } from '$lib/intlCache';

const USD: Intl.NumberFormatOptions = { style: 'currency', currency: 'USD' };

export function formatMoney(cents: number): string {
  return numberFormat('en-US', USD).format(cents / 100);
}

/** "12.50" for a form field. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}

/** "$1,234.5", "1234.50", "12" → cents. Null when it is not a positive
 *  amount with at most two decimals. */
export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$/, '').replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
