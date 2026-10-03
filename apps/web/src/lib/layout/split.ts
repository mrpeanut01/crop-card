/**
 * Phase 35: one counted seed lot over several picked blocks.
 *
 * The rules that decide whether a block may take a part of a lot, how much
 * room a block still has for it, and the leftover report live here so the
 * engine, the candidacy matrix and the AI validator all read them the same
 * way (rulings R-05, R-10, R-11, R-17). Pure and client-safe.
 */

import type { CropPlugin } from '$lib/plugins/schemas';
import type { BlockWithPlantings, SunExposure } from '$lib/db/blocks';
import type { Crop } from '$lib/db/crops';
import { rotationLookbackForFamily } from '$lib/calendar/rotation';
import { pluginsCross } from '$lib/plan/pollination';
import { plantsFitUsable } from './sufficiency';
import { bedPlantsFit, freeBedShare, plantsForShare, SHARE_EPSILON } from './bedSharing';
import type { Assignment, PlanInput, SeedRequest } from './engine';

export type BlockStatus =
  | 'full'
  | 'too-small'
  | 'keep-apart'
  | 'rotation'
  | 'cross-pollination'
  | 'sun'
  | 'narrow'
  | 'kept-in-one-bed';

export interface LeftoverBlock {
  blockId: string;
  status: BlockStatus;
  /** The other crop for keep-apart, rotation and cross-pollination. */
  withPluginId?: string;
}

export interface LeftoverReport {
  stockItemId: string;
  cropPluginId: string;
  plantsLeft: number;
  blocks: LeftoverBlock[];
}

const INACTIVE = new Set(['archived', 'failed', 'harvested']);
const DAY_MS = 86_400_000;

export function isActiveCrop(c: Pick<Crop, 'status'>): boolean {
  return !INACTIVE.has(c.status);
}

export function isSharedBed(input: PlanInput, blockId: string): boolean {
  return (input.bedBlockIds ?? []).includes(blockId);
}

function blockOf(input: PlanInput, blockId: string): BlockWithPlantings | undefined {
  return input.blocks.find((b) => b.id === blockId);
}

/** Crop plugins on a block: active existing plantings plus parts placed
 *  earlier in this run, in a stable order. */
export function cropsOnBlock(
  input: PlanInput,
  blockId: string,
  placed: ReadonlyArray<Pick<Assignment, 'blockId' | 'cropPluginId'>>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of input.existingCrops) {
    if (c.blockId !== blockId || !isActiveCrop(c) || seen.has(c.cropPluginId)) continue;
    seen.add(c.cropPluginId);
    out.push(c.cropPluginId);
  }
  for (const a of placed) {
    if (a.blockId !== blockId || seen.has(a.cropPluginId)) continue;
    seen.add(a.cropPluginId);
    out.push(a.cropPluginId);
  }
  return out;
}

/** Crops on the block that the companion data says to keep apart from
 *  `cropPluginId` (`badWith` already folds in `keepApart`). */
export function keepApartCrops(
  input: PlanInput,
  cropPluginId: string,
  blockId: string,
  placed: ReadonlyArray<Pick<Assignment, 'blockId' | 'cropPluginId'>>
): string[] {
  const bad = input.companions[cropPluginId]?.badWith ?? [];
  if (bad.length === 0) return [];
  return cropsOnBlock(input, blockId, placed).filter((p) => bad.includes(p));
}

/** The first earlier planting of the same crop family on this block inside
 *  the family's rotation lookback, or null (the matrix's `rotationOk`). */
export function rotationConflict(
  input: PlanInput,
  plugin: CropPlugin,
  blockId: string
): string | null {
  const lookback = rotationLookbackForFamily(plugin.cropFamily);
  if (lookback <= 0) return null;
  const cutoff = (input.nowMs ?? Date.now()) - lookback * 365 * DAY_MS;
  for (const c of input.existingCrops) {
    if (c.blockId !== blockId) continue;
    if (c.plantingDate == null || c.plantingDate < cutoff) continue;
    const prior = input.pluginIndex[c.cropPluginId];
    if (prior && prior.cropFamily === plugin.cropFamily) return c.cropPluginId;
  }
  return null;
}

const crossCache = new WeakMap<object, Map<string, boolean>>();

function crosses(input: PlanInput, a: CropPlugin, b: CropPlugin): boolean {
  let cache = crossCache.get(input.pluginIndex);
  if (!cache) {
    cache = new Map();
    crossCache.set(input.pluginIndex, cache);
  }
  const key =
    a.pluginId < b.pluginId ? `${a.pluginId}|${b.pluginId}` : `${b.pluginId}|${a.pluginId}`;
  let hit = cache.get(key);
  if (hit === undefined) {
    hit = pluginsCross(a, b, input.pluginIndex as Record<string, CropPlugin>);
    cache.set(key, hit);
  }
  return hit;
}

/** A different crop on the block that crosses with this one. On the same
 *  block the distance is zero, so it can never be isolated. */
export function crossingCrop(
  input: PlanInput,
  plugin: CropPlugin,
  blockId: string,
  placed: ReadonlyArray<Pick<Assignment, 'blockId' | 'cropPluginId'>>
): string | null {
  for (const p of cropsOnBlock(input, blockId, placed)) {
    if (p === plugin.pluginId) continue;
    const other = input.pluginIndex[p];
    if (other && crosses(input, plugin, other)) return p;
  }
  return null;
}

export function defaultSunForFamily(family: string): SunExposure {
  if (family === 'brassica') return 'partial';
  return 'full';
}

/** How well the block's recorded sun suits the crop. Unknown sun reads as
 *  `partial`, so it never rules a block out. */
export function sunMatchOf(
  seed: Pick<SeedRequest, 'sunRequirement'>,
  plugin: CropPlugin,
  blockSun: SunExposure | null | undefined
): 'full' | 'partial' | 'none' {
  if (blockSun == null) return 'partial';
  const want = seed.sunRequirement ?? defaultSunForFamily(plugin.cropFamily);
  if (want === blockSun) return 'full';
  if (
    (want === 'full' && blockSun === 'partial') ||
    (want === 'partial' && (blockSun === 'full' || blockSun === 'shade'))
  ) {
    return 'partial';
  }
  return 'none';
}

function sqrtAcresFt(block: BlockWithPlantings): number | null {
  if (!block.acres || block.acres <= 0) return null;
  return Math.sqrt(block.acres * 43_560);
}

function bedMinDimFt(block: BlockWithPlantings): number | null {
  if (block.widthFt && block.lengthFt) return Math.min(block.widthFt, block.lengthFt);
  return sqrtAcresFt(block);
}

/** The block is narrower than the crop's rows: two rows on a field block,
 *  one across a bed (a bed is planted from its edges). */
export function isNarrow(
  block: BlockWithPlantings,
  plugin: CropPlugin,
  sharedBed: boolean
): boolean {
  const rowIn = plugin.plantingGuide?.rowSpacingIn ?? plugin.defaultRowSpacingInches ?? 12;
  const minDimFt = sharedBed ? bedMinDimFt(block) : sqrtAcresFt(block);
  return minDimFt != null && minDimFt < ((sharedBed ? 1 : 2) * rowIn) / 12;
}

/** Plants of the crop the whole block holds when empty. */
export function emptyCapacity(input: PlanInput, plugin: CropPlugin, blockId: string): number {
  const block = blockOf(input, blockId);
  if (!block) return 0;
  return isSharedBed(input, blockId) ? bedPlantsFit(block, plugin) : plantsFitUsable(block, plugin);
}

/** The field engine's capacity model: a block holds `plantsFitUsable` of a
 *  crop, and every planting on it (existing or placed) uses its plant count
 *  of that, whatever the crop. An existing planting with no quantity counts
 *  as half the block at its own spacing. */
function fieldExistingUsage(input: PlanInput, block: BlockWithPlantings): number {
  let sum = 0;
  for (const c of input.existingCrops) {
    if (c.blockId !== block.id || !isActiveCrop(c)) continue;
    const cropPlugin = input.pluginIndex[c.cropPluginId];
    if (!cropPlugin) continue;
    if (c.quantityPlanted != null) sum += c.quantityPlanted;
    else sum += plantsFitUsable(block, cropPlugin) * 0.5;
  }
  return sum;
}

/** Share of a bed still free after existing plantings and `placed`, taken
 *  off in placement order exactly as the bed packer does. */
export function bedFreeAfter(
  input: PlanInput,
  blockId: string,
  placed: ReadonlyArray<Pick<Assignment, 'blockId' | 'cropPluginId' | 'plants'>>
): number {
  const block = blockOf(input, blockId);
  if (!block) return 0;
  let free = freeBedShare(block, input.existingCrops, input.pluginIndex);
  for (const a of placed) {
    if (a.blockId !== blockId) continue;
    const plugin = input.pluginIndex[a.cropPluginId];
    const fit = plugin ? bedPlantsFit(block, plugin) : 0;
    if (fit <= 0) continue;
    free = Math.max(0, free - a.plants / fit);
  }
  return free;
}

/** Plants used on a field block so far (existing plus placed), in the
 *  engine's plant-count model. */
export function fieldUsed(
  input: PlanInput,
  blockId: string,
  placed: ReadonlyArray<Pick<Assignment, 'blockId' | 'plants'>>
): number {
  const block = blockOf(input, blockId);
  if (!block) return 0;
  let used = fieldExistingUsage(input, block);
  for (const a of placed) if (a.blockId === blockId) used += a.plants;
  return used;
}

/** Share of a field block taken so far: each planting uses its plants over
 *  what the whole block holds of its own crop; an existing planting with no
 *  quantity counts as half the block. */
export function fieldShareUsed(
  input: PlanInput,
  blockId: string,
  placed: ReadonlyArray<Pick<Assignment, 'blockId' | 'cropPluginId' | 'plants'>>
): number {
  const block = blockOf(input, blockId);
  if (!block) return 0;
  let share = 0;
  for (const c of input.existingCrops) {
    if (c.blockId !== block.id || !isActiveCrop(c)) continue;
    const plugin = input.pluginIndex[c.cropPluginId];
    if (!plugin) continue;
    const fit = plantsFitUsable(block, plugin);
    if (c.quantityPlanted != null && fit > 0) share += c.quantityPlanted / fit;
    else share += 0.5;
  }
  for (const a of placed) {
    if (a.blockId !== blockId) continue;
    const plugin = input.pluginIndex[a.cropPluginId];
    const fit = plugin ? plantsFitUsable(block, plugin) : 0;
    if (fit > 0) share += a.plants / fit;
  }
  return share;
}

/** Whole plants of `seed` that still fit on `blockId` after `placed`
 *  (engine 1.0 capacity on fields, free share on beds). On a field block
 *  the engine's plant count is also held to one whole block of space, so a
 *  block filled by a wide crop is not then packed with a narrow one. */
export function roomFor(
  input: PlanInput,
  seed: Pick<SeedRequest, 'cropPluginId'>,
  blockId: string,
  placed: ReadonlyArray<Pick<Assignment, 'blockId' | 'cropPluginId' | 'plants'>>
): number {
  const plugin = input.pluginIndex[seed.cropPluginId];
  const block = blockOf(input, blockId);
  if (!plugin || !block) return 0;
  if (isSharedBed(input, blockId)) {
    return plantsForShare(bedFreeAfter(input, blockId, placed), bedPlantsFit(block, plugin));
  }
  const cap = plantsFitUsable(block, plugin);
  const byCount = Math.floor(cap - fieldUsed(input, blockId, placed) + SHARE_EPSILON);
  const byShare = plantsForShare(1 - fieldShareUsed(input, blockId, placed), cap);
  return Math.max(0, Math.min(byCount, byShare));
}

/** null when the block may take this part. `firstPart` applies only the
 *  every-part rules (R-05). */
export function blockRuleOut(
  input: PlanInput,
  seed: SeedRequest,
  blockId: string,
  placed: ReadonlyArray<Assignment>,
  firstPart: boolean
): LeftoverBlock | null {
  const plugin = input.pluginIndex[seed.cropPluginId];
  const block = blockOf(input, blockId);
  if (!plugin || !block) return { blockId, status: 'too-small' };

  const apart = keepApartCrops(input, seed.cropPluginId, blockId, placed);
  if (apart.length > 0) return { blockId, status: 'keep-apart', withPluginId: apart[0] };

  if (seed.keepInOneBed) {
    const home = placed.find((a) => a.stockItemId === seed.stockItemId);
    if (home && home.blockId !== blockId) return { blockId, status: 'kept-in-one-bed' };
  }

  if (firstPart) return null;

  const rotation = rotationConflict(input, plugin, blockId);
  if (rotation) return { blockId, status: 'rotation', withPluginId: rotation };

  const crossing = crossingCrop(input, plugin, blockId, placed);
  if (crossing) return { blockId, status: 'cross-pollination', withPluginId: crossing };

  if (sunMatchOf(seed, plugin, block.sunExposure) === 'none') return { blockId, status: 'sun' };

  const shared = isSharedBed(input, blockId);
  if (isNarrow(block, plugin, shared)) return { blockId, status: 'narrow' };

  if (emptyCapacity(input, plugin, blockId) <= 0) return { blockId, status: 'too-small' };

  return null;
}

/** Plants of each lot placed so far. */
export function placedPlantsByLot(placed: ReadonlyArray<Assignment>): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of placed) out.set(a.stockItemId, (out.get(a.stockItemId) ?? 0) + a.plants);
  return out;
}

/** Why one picked block cannot take more of a lot. null when it still can
 *  (the block has room and no rule says no). */
export function blockStatusFor(
  input: PlanInput,
  seed: SeedRequest,
  blockId: string,
  placed: ReadonlyArray<Assignment>
): LeftoverBlock | null {
  const firstPart = !placed.some((a) => a.stockItemId === seed.stockItemId);
  const rule = blockRuleOut(input, seed, blockId, placed, firstPart);
  const room = roomFor(input, seed, blockId, placed);
  if (rule && rule.status !== 'kept-in-one-bed') return rule;
  if (room <= 0) {
    const plugin = input.pluginIndex[seed.cropPluginId];
    const empty = plugin ? emptyCapacity(input, plugin, blockId) : 0;
    return { blockId, status: empty <= 0 ? 'too-small' : 'full' };
  }
  return rule;
}

/** One report per counted seed with plants left after `placed`. Every
 *  picked block that is full or ruled out is listed with its status; a
 *  block that could still take more (only possible for a plan the engine
 *  did not make) is left off the list. */
export function leftoverReports(
  input: PlanInput,
  placed: ReadonlyArray<Assignment>
): LeftoverReport[] {
  const byLot = placedPlantsByLot(placed);
  const out: LeftoverReport[] = [];
  for (const seed of input.seeds) {
    if (seed.fillToCapacity) continue;
    const left = seed.quantityPlants - (byLot.get(seed.stockItemId) ?? 0);
    if (left <= 0) continue;
    const blocks: LeftoverBlock[] = [];
    for (const b of input.blocks) {
      const status = blockStatusFor(input, seed, b.id, placed);
      if (status) blocks.push(status);
    }
    out.push({
      stockItemId: seed.stockItemId,
      cropPluginId: seed.cropPluginId,
      plantsLeft: left,
      blocks
    });
  }
  return out;
}

/** Picked blocks that could still take more of a counted, split-able lot
 *  that is placed below its count (R-17). Empty when the lot is whole, kept
 *  in one bed, sized to the bed, or every block is full or ruled out. */
export function blocksWithRoomForLeftover(
  input: PlanInput,
  seed: SeedRequest,
  placed: ReadonlyArray<Assignment>
): string[] {
  if (seed.fillToCapacity || seed.keepInOneBed) return [];
  const got = placed
    .filter((a) => a.stockItemId === seed.stockItemId)
    .reduce((s, a) => s + a.plants, 0);
  if (got >= seed.quantityPlants) return [];
  return input.blocks
    .filter((b) => blockStatusFor(input, seed, b.id, placed) === null)
    .map((b) => b.id);
}
