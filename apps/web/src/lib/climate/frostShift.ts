import type { FrostField } from './frostSuggest';

/** Moves a `MM-DD` date by `days` inside a non-leap year. */
export function shiftMmdd(mmdd: string, days: number): string | null {
  const m = /^(\d{2})-(\d{2})$/.exec(mmdd);
  if (!m) return null;
  const d = new Date(Date.UTC(2001, Number(m[1]) - 1, Number(m[2])));
  if (d.getUTCMonth() !== Number(m[1]) - 1) return null;
  d.setUTCDate(d.getUTCDate() + days);
  if (d.getUTCFullYear() !== 2001) return null;
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const SPRING: ReadonlySet<FrostField> = new Set(['lastFrost', 'lastHardFrost']);

/** A colder spot: spring frost ends later and fall frost comes earlier. */
export function colderFrostDates(
  values: Partial<Record<FrostField, string | null>>,
  days: number
): Partial<Record<FrostField, string>> {
  const out: Partial<Record<FrostField, string>> = {};
  for (const [f, v] of Object.entries(values) as Array<[FrostField, string | null]>) {
    if (!v) continue;
    const moved = shiftMmdd(v, SPRING.has(f) ? days : -days);
    if (moved) out[f] = moved;
  }
  return out;
}
