import { DEFAULT_PREFS, formatQuantity, type Prefs, type Quantity } from '$lib/prefs';

export function fmtRange(range: { min: number; max: number } | undefined, unit?: string): string {
  if (!range) return '—';
  const u = unit ? ` ${unit}` : '';
  if (range.min === range.max) return `${range.min}${u}`;
  return `${range.min}–${range.max}${u}`;
}

/** A stored-US range shown in the user's units: "80–85°F" / "27–29°C". */
export function fmtQtyRange(
  min: number,
  max: number,
  q: Quantity,
  prefs: Pick<Prefs, 'units'> = DEFAULT_PREFS,
  digits?: number
): string {
  const lo = formatQuantity(min, q, prefs, { digits, bare: true });
  const full = formatQuantity(max, q, prefs, { digits });
  if (min === max) return full;
  return `${lo}–${full}`;
}

/** US value packed into a harvest quantity/lot string. Stored text stays
 *  in lb/in regardless of the units the operator typed in. */
export function usText(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  return String(Number(v.toFixed(2)));
}
