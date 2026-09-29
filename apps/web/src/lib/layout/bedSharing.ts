/**
 * #440 — garden and greenhouse beds are shared by area, not by plant count.
 *
 * A bed's capacity for one crop is `bedPlantsFit(bed, crop)`. A crop placed
 * with `plants` uses the share `plants / bedPlantsFit` of the bed, and the
 * shares of every crop on one bed (existing plantings included) must add up
 * to 1.0 or less. Field blocks keep the one-crop-per-block model and the
 * older plant-count capacity, so this only applies to blocks whose Area is a
 * garden or greenhouse.
 */

import type { BlockWithPlantings } from '$lib/db/blocks';
import type { Crop } from '$lib/db/crops';
import type { CropPlugin } from '$lib/plugins/schemas';
import { DESIGNABLE_AREA_KINDS } from '$lib/farm/areaKinds';
import { footprintSqFt, plantsFitUsable, usableSqft } from './sufficiency';

/** The shares on one shared bed may add up to this at most. */
export const BED_SHARE_CAP = 1;

/** Rounding slack when comparing summed shares against the cap. */
export const SHARE_EPSILON = 1e-6;

type BlockLike = Pick<BlockWithPlantings, 'acres' | 'geometryGeojson' | 'widthFt' | 'lengthFt'>;

/** Blocks in garden or greenhouse Areas, which share their space by area. */
export function sharedBedBlockIds(
  blocks: ReadonlyArray<{ id: string; fieldId?: string | null }>,
  fields: ReadonlyArray<{ id: string; kind: string }>
): string[] {
  const bedAreas = new Set(
    fields
      .filter((f) => (DESIGNABLE_AREA_KINDS as readonly string[]).includes(f.kind))
      .map((f) => f.id)
  );
  return blocks.filter((b) => b.fieldId && bedAreas.has(b.fieldId)).map((b) => b.id);
}

/** Plantable square feet of a bed. A bed is worked from its edges, so there
 *  is no perimeter buffer: typed dimensions win, then the drawn shape, then
 *  the stored acres. */
export function bedUsableSqft(block: BlockLike): number {
  if (block.widthFt && block.lengthFt && block.widthFt > 0 && block.lengthFt > 0) {
    return block.widthFt * block.lengthFt;
  }
  return usableSqft(block, 0).sqft;
}

/** Plants of one crop that fill the whole bed. */
export function bedPlantsFit(block: BlockLike, plugin: CropPlugin): number {
  const sqft = bedUsableSqft(block);
  const per = footprintSqFt(plugin);
  if (sqft <= 0 || per <= 0) return 0;
  return Math.floor(sqft / per);
}

/** Whole-block capacity for one crop: shared beds use the bed math, field
 *  blocks the buffered `plantsFitUsable`. */
export function blockCapacity(block: BlockLike, plugin: CropPlugin, sharedBed: boolean): number {
  return sharedBed ? bedPlantsFit(block, plugin) : plantsFitUsable(block, plugin);
}

const INACTIVE = new Set(['archived', 'failed', 'harvested']);

/** Share of a bed already taken by plantings on it. The planting's plant
 *  count wins (the plan or the designer set it), then its quantity; a
 *  planting with neither is counted as half the bed, the same assumption
 *  the field engine makes. */
export function existingBedShare(
  block: BlockLike & { id: string },
  existingCrops: ReadonlyArray<Crop>,
  pluginIndex: Readonly<Record<string, CropPlugin>>
): number {
  let share = 0;
  for (const c of existingCrops) {
    if (c.blockId !== block.id || INACTIVE.has(c.status)) continue;
    const plugin = pluginIndex[c.cropPluginId];
    if (!plugin) continue;
    const fit = bedPlantsFit(block, plugin);
    if (c.plantCount != null && c.plantCount > 0 && fit > 0) share += c.plantCount / fit;
    else if (c.quantityPlanted != null && fit > 0) share += c.quantityPlanted / fit;
    else share += 0.5;
  }
  return Math.min(BED_SHARE_CAP, share);
}

/** Share of a bed still free for new crops. */
export function freeBedShare(
  block: BlockLike & { id: string },
  existingCrops: ReadonlyArray<Crop>,
  pluginIndex: Readonly<Record<string, CropPlugin>>
): number {
  return Math.max(0, BED_SHARE_CAP - existingBedShare(block, existingCrops, pluginIndex));
}

/** Plants for a share of a bed, rounded down. */
export function plantsForShare(share: number, fullFit: number): number {
  if (!(share > 0) || !(fullFit > 0)) return 0;
  return Math.floor(share * fullFit + SHARE_EPSILON);
}
