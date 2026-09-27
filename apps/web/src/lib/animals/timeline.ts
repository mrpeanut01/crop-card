/** Where one subject lived, as half-open stays `[fromMs, toMs)`; `toMs` null
 *  is the current stay. Zero-length rows (`fromMs === toMs`) only mark a
 *  group change and take up no time. Moves can arrive backdated or out of
 *  order from the offline queue, so a new stay is slotted into the timeline
 *  rather than appended. Pure, so the no-overlap rule is property-tested. */

export interface Stay {
  id: string;
  fromMs: number;
  toMs: number | null;
}

export type StayInsertPlan =
  | { ok: true; truncate: { id: string; toMs: number } | null; toMs: number | null }
  | { ok: false; reason: 'same-time' };

export function isMarker(stay: Stay): boolean {
  return stay.toMs !== null && stay.toMs === stay.fromMs;
}

function occupying(stays: readonly Stay[]): Stay[] {
  return stays.filter((s) => !isMarker(s)).sort((a, b) => a.fromMs - b.fromMs);
}

/** The stay covering `at`, if any. */
export function stayAt<T extends Stay>(stays: readonly T[], at: number): T | undefined {
  return stays.find((s) => !isMarker(s) && s.fromMs <= at && (s.toMs === null || at < s.toMs));
}

/** Plans a new stay starting at `at`: the stay covering `at` is cut short
 *  there, and the new stay runs until that stay's old end, or until the next
 *  recorded stay, or stays open. Two stays cannot start at the same moment. */
export function planStayInsert(stays: readonly Stay[], at: number): StayInsertPlan {
  const rows = occupying(stays);
  if (rows.some((s) => s.fromMs === at)) return { ok: false, reason: 'same-time' };
  const covering = rows.find((s) => s.fromMs < at && (s.toMs === null || at < s.toMs));
  if (covering) {
    return { ok: true, truncate: { id: covering.id, toMs: at }, toMs: covering.toMs };
  }
  const next = rows.find((s) => s.fromMs > at);
  return { ok: true, truncate: null, toMs: next ? next.fromMs : null };
}

export function openStay<T extends Stay>(stays: readonly T[]): T | undefined {
  return stays.find((s) => s.toMs === null);
}

/** True when no two stays share any moment and at most one is open. */
export function isNonOverlapping(stays: readonly Stay[]): boolean {
  const rows = occupying(stays);
  if (rows.filter((s) => s.toMs === null).length > 1) return false;
  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    if (s.toMs !== null && s.toMs < s.fromMs) return false;
    const next = rows[i + 1];
    if (next && (s.toMs === null || s.toMs > next.fromMs)) return false;
  }
  return true;
}
