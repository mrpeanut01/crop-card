export function rangeText(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const { min, max } = v as { min?: unknown; max?: unknown };
  const lo = typeof min === 'number' && Number.isFinite(min) ? min : undefined;
  const hi = typeof max === 'number' && Number.isFinite(max) ? max : undefined;
  if (lo === undefined && hi === undefined) return undefined;
  if (lo === undefined) return `≤${hi}`;
  if (hi === undefined) return `≥${lo}`;
  if (lo === hi) return `${lo}`;
  return `${lo}–${hi}`;
}
