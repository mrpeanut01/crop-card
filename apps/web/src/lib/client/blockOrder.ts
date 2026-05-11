/**
 * Persist user-picked block ordering across surfaces (Schedule swim-lane,
 * Crops page) in localStorage. The order is shared so top-to-bottom on
 * Crops matches left-to-right on Schedule.
 *
 * Format: JSON array of block IDs. Unknown IDs are skipped on apply;
 * blocks not in the saved order are appended at the end so newly-added
 * blocks remain visible.
 */

const ORDER_KEY = 'cropcard.swimlane.column-order.v1';

export function loadBlockOrder(): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ORDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
      return parsed as string[];
    }
    return null;
  } catch {
    return null;
  }
}

export function saveBlockOrder(order: ReadonlyArray<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    // quota exceeded or storage unavailable — silent
  }
}

/**
 * Apply a saved order to a list of blocks, preserving the saved order for
 * known IDs and appending any blocks not present in the saved order in
 * their original (server-provided) order. If `saved` is null/empty, returns
 * `blocks` unchanged.
 */
export function applyBlockOrder<T extends { id: string }>(
  blocks: ReadonlyArray<T>,
  saved: ReadonlyArray<string> | null
): T[] {
  if (!saved || saved.length === 0) return [...blocks];
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const out: T[] = [];
  for (const id of saved) {
    const b = byId.get(id);
    if (b) {
      out.push(b);
      byId.delete(id);
    }
  }
  for (const b of blocks) if (byId.has(b.id)) out.push(b);
  return out;
}

/** Compute a new order after dropping `sourceId` onto `targetId` in the
 *  current visible order. Returns null if the move is a no-op. */
export function reorderOnDrop(
  current: ReadonlyArray<string>,
  sourceId: string,
  targetId: string
): string[] | null {
  if (sourceId === targetId) return null;
  const fromIdx = current.indexOf(sourceId);
  const toIdx = current.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return null;
  const next = [...current];
  next.splice(fromIdx, 1);
  next.splice(toIdx, 0, sourceId);
  return next;
}
