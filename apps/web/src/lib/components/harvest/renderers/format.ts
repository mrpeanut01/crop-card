export function fmtRange(range: { min: number; max: number } | undefined, unit?: string): string {
  if (!range) return '—';
  const u = unit ? ` ${unit}` : '';
  if (range.min === range.max) return `${range.min}${u}`;
  return `${range.min}–${range.max}${u}`;
}
