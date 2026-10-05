import { DESIGNABLE_AREA_KINDS } from '$lib/farm/areaKinds';
import { splitNoun } from '$lib/plan/splitGroup';
import type { Translator } from '$lib/i18n';
import type { FarmSnapshot, SnapshotBlock, SnapshotPlanting } from '../snapshot';

export interface SnapshotSplit {
  n: number;
  noun: 'beds' | 'blocks';
  /** The other parts' blocks, in the snapshot's block order. */
  others: SnapshotBlock[];
}

/** The Phase 35 split a planting is a part of, read from the snapshot the
 *  way /plan reads it from its loaded plantings. Null when it is not a
 *  part of a lot on two or more blocks, or the bundle predates version 5. */
export function snapshotSplitFor(
  snapshot: Pick<FarmSnapshot, 'splitGroups' | 'blocks' | 'areas'>,
  p: Pick<SnapshotPlanting, 'splitGroupId' | 'blockId'>
): SnapshotSplit | null {
  const ids = p.splitGroupId ? snapshot.splitGroups?.[p.splitGroupId] : undefined;
  if (!ids || ids.length < 2) return null;
  const bedAreaIds = new Set(
    snapshot.areas
      .filter((a) => (DESIGNABLE_AREA_KINDS as readonly string[]).includes(a.kind))
      .map((a) => a.id)
  );
  const idSet = new Set(ids);
  const blocks = snapshot.blocks.filter((b) => idSet.has(b.id));
  const bedIds = blocks.filter((b) => b.areaId && bedAreaIds.has(b.areaId)).map((b) => b.id);
  return {
    n: ids.length,
    noun: splitNoun(ids, bedIds),
    others: blocks.filter((b) => b.id !== p.blockId)
  };
}

/** "One seed lot in N beds" (or blocks), the line /plan's Planting card shows. */
export function splitLine(split: SnapshotSplit, tr: Translator): string {
  return split.noun === 'beds'
    ? tr('plan.split.lineBeds', { n: split.n })
    : tr('plan.split.lineBlocks', { n: split.n });
}
