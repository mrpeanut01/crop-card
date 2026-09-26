import { formatQuantity, type Prefs } from '$lib/prefs';
import { trimNumber } from './common';

const SQFT_PER_ACRE = 43_560;

export interface Sized {
  acres: number | null;
  widthFt: number | null;
  lengthFt: number | null;
}

function positive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function dims(widthFt: number, lengthFt: number, prefs: Pick<Prefs, 'units'>): string {
  if (prefs.units === 'metric') {
    const m = (ft: number) => trimNumber(ft * 0.3048, 1);
    return `${m(widthFt)}×${m(lengthFt)} m`;
  }
  return `${trimNumber(widthFt, 1)}×${trimNumber(lengthFt, 1)} ft`;
}

/** "30×40 ft" for anything under an acre drawn with dimensions, otherwise
 *  "20 ac" (or hectares). Null when nothing is known. */
export function formatSize(s: Sized, prefs: Pick<Prefs, 'units'>): string | null {
  const hasDims = positive(s.widthFt) && positive(s.lengthFt);
  if (hasDims && s.widthFt! * s.lengthFt! < SQFT_PER_ACRE) {
    return dims(s.widthFt!, s.lengthFt!, prefs);
  }
  if (positive(s.acres)) return formatQuantity(s.acres, 'area', prefs);
  if (hasDims) return formatQuantity((s.widthFt! * s.lengthFt!) / SQFT_PER_ACRE, 'area', prefs);
  return null;
}

export function formatInches(
  value: number | { min: number; max: number },
  prefs: Pick<Prefs, 'units'>
): string {
  const unit = prefs.units === 'metric' ? 'cm' : 'in';
  const conv = (n: number) => trimNumber(prefs.units === 'metric' ? n * 2.54 : n, 1);
  if (typeof value === 'number') return `${conv(value)} ${unit}`;
  const a = conv(value.min);
  const b = conv(value.max);
  return a === b ? `${a} ${unit}` : `${a}–${b} ${unit}`;
}

export function formatFeet(value: number, prefs: Pick<Prefs, 'units'>): string {
  return prefs.units === 'metric'
    ? `${trimNumber(value * 0.3048, 1)} m`
    : `${trimNumber(value, 1)} ft`;
}
