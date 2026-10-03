/** Phase 35: one seed lot planted across several blocks (rulings R-12, R-18,
 *  R-22). Pure and client-safe. */

/** The shape of a split group id the wizard mints at commit. */
export const SPLIT_GROUP_ID_PATTERN = /^sg_[A-Za-z0-9-]{8,64}$/;

const WHOLE_UNITS = new Set(['seeds', 'count', 'packets']);

/** True for units that can only be drawn in whole numbers. */
export function isWholeUnit(unit: string): boolean {
  return WHOLE_UNITS.has(unit);
}

/** stockItemId -> number of distinct blocks, for lots on two or more. */
export function splitLots(
  rows: ReadonlyArray<{ stockItemId: string; blockId: string }>
): Map<string, number> {
  const blocksByLot = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = blocksByLot.get(r.stockItemId) ?? new Set<string>();
    set.add(r.blockId);
    blocksByLot.set(r.stockItemId, set);
  }
  const out = new Map<string, number>();
  for (const [lot, set] of blocksByLot) if (set.size >= 2) out.set(lot, set.size);
  return out;
}

/** Apportions a lot's selected quantity over its rows by plants (R-18).
 *  Keys are the caller's row keys; values add up to `selectedQty`. Whole
 *  units use largest remainder; other units do the same in thousandths,
 *  so no row is ever negative. */
export function apportionLotQuantity(
  selectedQty: number,
  unit: string,
  rows: ReadonlyArray<{ key: string; plants: number }>
): Map<string, number> {
  const out = new Map<string, number>();
  if (rows.length === 0) return out;
  const qty = Number.isFinite(selectedQty) ? Math.max(0, selectedQty) : 0;
  const weights = rows.map((r) => (Number.isFinite(r.plants) ? Math.max(0, r.plants) : 0));
  const totalWeight = weights.reduce((s, x) => s + x, 0);
  const scale = isWholeUnit(unit) ? 1 : 1000;
  const target = Math.round(qty * scale);
  const parts = rows.map((r, i) => {
    const raw = totalWeight > 0 ? (weights[i] / totalWeight) * target : target / rows.length;
    return { key: r.key, i, floor: Math.floor(raw), frac: raw - Math.floor(raw) };
  });
  let rest = target - parts.reduce((s, p) => s + p.floor, 0);
  const order = [...parts].sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const p of order) {
    if (rest <= 0) break;
    p.floor += 1;
    rest -= 1;
  }
  for (const p of parts) out.set(p.key, (out.get(p.key) ?? 0) + p.floor);
  if (scale !== 1) for (const [k, v] of out) out.set(k, v / scale);
  return out;
}

/** A fresh split group id. */
export function mintSplitGroupId(uuid: () => string = () => crypto.randomUUID()): string {
  return `sg_${uuid()}`;
}

/** One group id per lot that the plan puts on two or more blocks (R-12). */
export function splitGroupIds(
  rows: ReadonlyArray<{ stockItemId: string; blockId: string }>,
  mint: () => string = () => mintSplitGroupId()
): Map<string, string> {
  const out = new Map<string, string>();
  for (const lot of splitLots(rows).keys()) out.set(lot, mint());
  return out;
}

/** Archived and failed plantings no longer count as a part (R-22). */
const DEAD_STATUSES = new Set(['archived', 'failed']);

export interface SplitGroupBlock {
  blockId: string;
  blockName: string;
  areaId: string | null;
}

/** Group id -> the distinct blocks holding a live planting of it, for
 *  groups on two or more blocks. Reads only what /plan already loaded. */
export function splitGroupBlocks(
  blocks: ReadonlyArray<{
    id: string;
    name: string;
    fieldId?: string | null;
    plantings: ReadonlyArray<{ splitGroupId?: string | null; status?: string }>;
  }>
): Map<string, SplitGroupBlock[]> {
  const byGroup = new Map<string, SplitGroupBlock[]>();
  for (const b of blocks) {
    const seen = new Set<string>();
    for (const p of b.plantings) {
      const g = p.splitGroupId;
      if (!g || seen.has(g) || (p.status && DEAD_STATUSES.has(p.status))) continue;
      seen.add(g);
      const list = byGroup.get(g) ?? [];
      list.push({ blockId: b.id, blockName: b.name, areaId: b.fieldId ?? null });
      byGroup.set(g, list);
    }
  }
  for (const [g, list] of byGroup) if (list.length < 2) byGroup.delete(g);
  return byGroup;
}

/** "beds" when every block is a garden or greenhouse bed, else "blocks" (R-20). */
export function splitNoun(
  blockIds: ReadonlyArray<string>,
  sharedBedBlockIds: ReadonlySet<string> | ReadonlyArray<string>
): 'beds' | 'blocks' {
  const set = sharedBedBlockIds instanceof Set ? sharedBedBlockIds : new Set(sharedBedBlockIds);
  return blockIds.length > 0 && blockIds.every((id) => set.has(id)) ? 'beds' : 'blocks';
}
