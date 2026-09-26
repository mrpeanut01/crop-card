import { BED_STYLE_LABELS } from '$lib/farm/areaKinds';
import type { BedLayout, PlacedPlanting, SpacingPattern } from '$lib/garden/types';

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

export const PATTERN_LABELS: Record<SpacingPattern, string> = {
  square: 'Rows',
  offset: 'Offset',
  sfg: 'Square foot'
};

/** "July 15" for a UTC day. */
export function longDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** `YYYY-MM-DD` for a UTC day. */
export function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function parseYmd(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Feet with at most one decimal, no trailing zero: 4, 2.5. */
export function ft(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function sizeLabel(widthFt: number, lengthFt: number): string {
  return `${ft(widthFt)}×${ft(lengthFt)} ft`;
}

export function bedKindLabel(bed: Pick<BedLayout, 'kind' | 'bedStyle'>): string {
  if (bed.kind === 'container') return 'container';
  const style = bed.bedStyle ? BED_STYLE_LABELS[bed.bedStyle].toLowerCase() : null;
  return style ? `${style} bed` : 'bed';
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function plantingLabel(p: Pick<PlacedPlanting, 'varietyDisplayName'>): string {
  return p.varietyDisplayName;
}

/** Stable family tint index so a family keeps its color everywhere. */
export function familyTone(family: string): number {
  let h = 0;
  for (let i = 0; i < family.length; i++) h = (h * 31 + family.charCodeAt(i)) >>> 0;
  return h % 6;
}
