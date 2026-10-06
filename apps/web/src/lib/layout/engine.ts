/**
 * Phase 14a — seed-to-block layout engine.
 *
 * Pure, deterministic, server-side. Given a list of seed requests (each
 * paired to a crop plugin + desired plant count), the engine assigns each
 * seed to one or more blocks using a greedy two-pass scoring scheme that
 * weighs companion-planting, sun-exposure, plant-height shade impact,
 * crop-family rotation, block capacity, and block geometry feasibility.
 *
 * Determinism is required: given identical input, the engine must produce
 * identical assignments — UI relies on stable preview re-renders. All
 * sorts are stable with explicit tiebreakers; floating-point comparisons
 * are bucketed.
 *
 * Phase 35: a counted seed lot spreads over the picked blocks before any of
 * it is left over. Which blocks may take a part, how much room is left and
 * the leftover report come from `split.ts`, which the AI validator shares.
 *
 * The engine never queries the DB; callers (the /api/crops/plan and
 * /commit endpoints) hydrate `PlanInput` from the existing repos and pass
 * the snapshot in.
 */

import type { CropPlugin } from '$lib/plugins/schemas';
import { rowSpacingOf } from '$lib/garden/plantCount';
import { isAreaCrop } from '$lib/plan/spacingModel';
import { cropCastsShade } from '$lib/calendar/engine';
import { rotationLookbackForFamily } from '$lib/calendar/rotation';
import type { BlockWithPlantings, SunExposure } from '$lib/db/blocks';
import type { Crop } from '$lib/db/crops';
import { footprintSqFt } from './sufficiency';
import { bedPlantsFit, plantsForShare } from './bedSharing';
import { bedFreeAfter, blockRuleOut, leftoverReports, roomFor, type LeftoverReport } from './split';

export type { LeftoverReport, LeftoverBlock, BlockStatus } from './split';

const SQFT_PER_ACRE = 43_560;
const FT_PER_INCH = 1 / 12;

export interface SeedRequest {
  stockItemId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  quantityPlants: number;
  /** Optional sun preference for this seed — when present, overrides the
   *  family fallback. Sourced from stock metadata `sunRequirement`. */
  sunRequirement?: SunExposure;
  /** #471 — the farmer set no quantity: size the crop to the space it gets
   *  (one field block, or a fair share of one bed). `quantityPlants` then
   *  only caps it. */
  fillToCapacity?: boolean;
  /** Phase 35 (R-14): keep this counted seed on one block; what does not
   *  fit there is left over instead of spreading to other blocks. */
  keepInOneBed?: boolean;
  /** #555: a crop sown by area. `quantityPlants` is then square feet. */
  byArea?: boolean;
}

export interface Assignment {
  stockItemId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  blockId: string;
  /** Engine units: plants, or square feet for a crop sown by area. */
  plants: number;
  /** #555: set for a crop sown by area; the same square feet as `plants`,
   *  which is then not a plant count. */
  areaSqFt?: number;
  quantityPlanted?: number;
  quantityUnit?: string;
  /** Per-block placement score for UI debug chips; higher = better fit. */
  score: number;
}

export interface PlanDiagnostic {
  stockItemId: string;
  cropPluginId: string;
  reason: string;
}

export interface PlanResult {
  assignments: Assignment[];
  /** Seeds with plants left, carrying the remainder (a fill seed only when
   *  it got no space at all). */
  unplaced: SeedRequest[];
  diagnostics: PlanDiagnostic[];
  /** Phase 35 (C-1): one report per counted seed with plants left, naming
   *  why each picked block could not take more. */
  leftover: LeftoverReport[];
}

export interface BlockAxisLite {
  blockId: string;
  east: number | null;
  north: number | null;
}

export interface PlanInput {
  seeds: ReadonlyArray<SeedRequest>;
  blocks: ReadonlyArray<BlockWithPlantings>;
  axes: ReadonlyArray<BlockAxisLite>;
  /** Existing committed crops (any status) used for rotation lookback +
   *  capacity consumption on already-occupied blocks. */
  existingCrops: ReadonlyArray<Crop>;
  pluginIndex: Readonly<Record<string, CropPlugin>>;
  companions: Readonly<
    Record<string, { goodWith: ReadonlyArray<string>; badWith: ReadonlyArray<string> }>
  >;
  /** #440 — blocks in garden or greenhouse Areas. Their crops share the bed
   *  by area (see `bedSharing.ts`); every other block keeps the field model. */
  bedBlockIds?: ReadonlyArray<string>;
  /** Clock for the rotation lookback; defaults to now. */
  nowMs?: number;
}

export const SCORE_WEIGHTS = {
  capacityFit: 30,
  sunMatch: 20,
  companionGood: 15,
  companionBad: -25,
  shadePenalty: -20,
  rotationPenalty: -40,
  fragmentationPenalty: -5,
  narrowBlockPenalty: -10,
  threeSistersBonus: 30
} as const;

/** Score floor for the first (tight) pass. Seeds that can't clear this on
 *  any block fall through to pass B. */
const MIN_SCORE_TIGHT = 25;
/** Score floor for the relaxed second pass. Below this we declare the
 *  seed unplaceable for the current selection set. */
const MIN_SCORE_LOOSE = 0;

// ─── Public API ──────────────────────────────────────────────────────────

export function planLayout(given: PlanInput): PlanResult {
  // #555: whether a seed is sown by area comes from its plugin, never the caller.
  const input: PlanInput = {
    ...given,
    seeds: given.seeds.map((s) => {
      const plugin = given.pluginIndex[s.cropPluginId];
      const byArea = !!plugin && isAreaCrop(plugin);
      if (byArea === !!s.byArea) return s;
      const { byArea: _drop, ...rest } = s;
      void _drop;
      return byArea ? { ...rest, byArea: true } : rest;
    })
  };
  const result = planWithoutReport(input);
  return { ...result, leftover: leftoverReports(input, result.assignments) };
}

type RawResult = Omit<PlanResult, 'leftover'>;

function planWithoutReport(input: PlanInput): RawResult {
  const bedIds = new Set(input.bedBlockIds ?? []);
  const beds = input.blocks.filter((b) => bedIds.has(b.id));
  if (beds.length === 0) return planFieldLayout(input);

  const fieldBlocks = input.blocks.filter((b) => !bedIds.has(b.id));
  const onFields: RawResult =
    fieldBlocks.length > 0
      ? planFieldLayout({ ...input, blocks: fieldBlocks, bedBlockIds: [] })
      : { assignments: [], unplaced: [...input.seeds], diagnostics: [] };
  // R-08: the beds get what is left of each seed, never the whole seed again.
  const bedResult = packSharedBeds(
    onFields.unplaced,
    beds,
    { ...input, blocks: beds },
    onFields.assignments
  );
  return {
    assignments: [...onFields.assignments, ...bedResult.assignments],
    unplaced: bedResult.unplaced,
    diagnostics: bedResult.diagnostics
  };
}

function hasPart(placed: ReadonlyArray<Assignment>, stockItemId: string): boolean {
  return placed.some((a) => a.stockItemId === stockItemId);
}

function planFieldLayout(input: PlanInput): RawResult {
  const seedsSorted = sortByTightness(input);
  const placed: Assignment[] = [];
  const state = initBlockState(input, placed);

  const unplaced: SeedRequest[] = [];
  const diagnostics: PlanDiagnostic[] = [];

  /** Places what fits. Pass A (whole seed only, tight floor) rolls back a
   *  seed that does not fit whole; pass B (no floor, R-04) keeps every part
   *  and reports the rest as left over. A keep-in-one-bed seed gets one
   *  block at most (R-14). */
  const tryPlace = (seed: SeedRequest, floor: number, keepPartial: boolean): number | null => {
    if (seed.fillToCapacity) {
      // One whole field block for a crop with no quantity: the best block
      // that still has room, never a partial rollback.
      const candidate = bestBlock(seed, seed.quantityPlants, state, input, floor, false, placed);
      if (!candidate) return null;
      placed.push(
        part(seed, candidate.blockId, Math.min(seed.quantityPlants, candidate.fit), candidate.score)
      );
      return 0;
    }
    let remainingPlants = seed.quantityPlants;
    const start = placed.length;
    while (remainingPlants > 0) {
      if (seed.keepInOneBed && placed.length > start) break;
      const later = placed.length > start;
      const candidate =
        keepPartial && later
          ? laterPartBlock(seed, remainingPlants, state, input, placed)
          : bestBlock(seed, remainingPlants, state, input, floor, keepPartial, placed);
      if (!candidate) break;
      const take = Math.min(remainingPlants, candidate.fit);
      placed.push(part(seed, candidate.blockId, take, candidate.score));
      remainingPlants -= take;
    }
    if (placed.length > start && (remainingPlants === 0 || keepPartial)) return remainingPlants;
    // Roll back partial placements before falling through to the next pass.
    placed.splice(start);
    return null;
  };

  // Pass A — tight floor, whole seed only.
  const passB: SeedRequest[] = [];
  for (const seed of seedsSorted) {
    if (tryPlace(seed, MIN_SCORE_TIGHT, false) === null) passB.push(seed);
  }
  // Pass B — no floor for counted seed; keeps a partial fit and reports the rest.
  for (const seed of passB) {
    const left = tryPlace(seed, seed.fillToCapacity ? MIN_SCORE_LOOSE : -Infinity, true);
    if (left === 0) continue;
    const rest = left === null ? seed : { ...seed, quantityPlants: left };
    unplaced.push(rest);
    diagnostics.push({
      stockItemId: seed.stockItemId,
      cropPluginId: seed.cropPluginId,
      reason:
        left === null
          ? noFitReason(seed, state, input)
          : `${seed.quantityPlants - left} of ${unitsText(seed, seed.quantityPlants)} fit; ${left} left over`
    });
  }

  return { assignments: placed, unplaced, diagnostics };
}

function part(seed: SeedRequest, blockId: string, plants: number, score: number): Assignment {
  return {
    stockItemId: seed.stockItemId,
    cropPluginId: seed.cropPluginId,
    varietyDisplayName: seed.varietyDisplayName,
    blockId,
    plants,
    ...(seed.byArea ? { areaSqFt: plants } : {}),
    score
  };
}

/** "N plants" or, for a crop sown by area, "N sq ft" (diagnostics only). */
function unitsText(seed: SeedRequest, n: number): string {
  return seed.byArea ? `${n} sq ft` : `${n} plants`;
}

// ─── Sorting ─────────────────────────────────────────────────────────────

function sortByTightness(input: PlanInput): SeedRequest[] {
  const scored = input.seeds.map((seed) => ({
    seed,
    tightness: tightnessOf(seed, input)
  }));
  scored.sort((a, b) => {
    // Seeds with a real quantity place before fill-to-capacity seeds, so a
    // crop the farmer counted is never crowded out by one they did not.
    const fa = a.seed.fillToCapacity ? 1 : 0;
    const fb = b.seed.fillToCapacity ? 1 : 0;
    if (fa !== fb) return fa - fb;
    if (b.tightness !== a.tightness) return b.tightness - a.tightness;
    if (a.seed.cropPluginId !== b.seed.cropPluginId) {
      return a.seed.cropPluginId < b.seed.cropPluginId ? -1 : 1;
    }
    return a.seed.stockItemId < b.seed.stockItemId ? -1 : 1;
  });
  return scored.map((s) => s.seed);
}

function tightnessOf(seed: SeedRequest, input: PlanInput): number {
  const plugin = input.pluginIndex[seed.cropPluginId];
  if (!plugin) return 0;
  let t = 0;
  if (cropCastsShade(plugin)) t += 2;
  if ((seed.sunRequirement ?? defaultSunForFamily(plugin.cropFamily)) === 'full') t += 1;
  t += companionEdgeCount(seed.cropPluginId, input.companions);
  t += rotationLookbackForFamily(plugin.cropFamily);
  if (typeof plugin.matureHeightFt === 'number') t += plugin.matureHeightFt / 8;
  t += footprintSqFt(plugin);
  return t;
}

function companionEdgeCount(pluginId: string, companions: PlanInput['companions']): number {
  const entry = companions[pluginId];
  if (!entry) return 0;
  return entry.goodWith.length + entry.badWith.length;
}

function defaultSunForFamily(family: string): SunExposure {
  if (family === 'brassica') return 'partial';
  if (family === 'corn' || family === 'solanaceae' || family === 'legume' || family === 'cucurbit')
    return 'full';
  return 'full';
}

// ─── Scoring ─────────────────────────────────────────────────────────────

interface BlockState {
  /** Whole plants of this crop the block still holds (`roomFor`). */
  remaining(blockId: string, pluginId: string): number;
  pluginsOn(blockId: string): Set<string>;
  block(blockId: string): BlockWithPlantings | undefined;
  axis(blockId: string): BlockAxisLite | undefined;
}

/** Block state read through `placed`, which the caller grows as it places
 *  parts. Room comes from `split.ts` so the engine, the leftover report and
 *  the AI validator agree on what "full" means. */
function initBlockState(
  input: PlanInput,
  placed: Assignment[],
  extraOn?: Map<string, Set<string>>
): BlockState {
  const blocksById = new Map<string, BlockWithPlantings>();
  for (const b of input.blocks) blocksById.set(b.id, b);
  const axisById = new Map<string, BlockAxisLite>();
  for (const a of input.axes) axisById.set(a.blockId, a);
  const existingOn = new Map<string, Set<string>>();
  for (const c of input.existingCrops) {
    if (!blocksById.has(c.blockId)) continue;
    let s = existingOn.get(c.blockId);
    if (!s) existingOn.set(c.blockId, (s = new Set()));
    s.add(c.cropPluginId);
  }

  return {
    remaining(blockId, pluginId) {
      return roomFor(input, { cropPluginId: pluginId }, blockId, placed);
    },
    pluginsOn(blockId) {
      const out = new Set(existingOn.get(blockId) ?? []);
      for (const a of placed) if (a.blockId === blockId) out.add(a.cropPluginId);
      for (const p of extraOn?.get(blockId) ?? []) out.add(p);
      return out;
    },
    block(blockId) {
      return blocksById.get(blockId);
    },
    axis(blockId) {
      return axisById.get(blockId);
    }
  };
}

interface Candidate {
  blockId: string;
  score: number;
  fit: number;
}

function bestBlock(
  seed: SeedRequest,
  remainingPlants: number,
  state: BlockState,
  input: PlanInput,
  floor: number,
  /** Score each block on the plants it can take, so a seed bigger than
   *  every block is judged on sun, companions and rotation, not on size. */
  partial: boolean,
  placed: ReadonlyArray<Assignment>
): Candidate | null {
  const plugin = input.pluginIndex[seed.cropPluginId];
  if (!plugin) return null;
  const firstPart = seed.fillToCapacity ? true : !hasPart(placed, seed.stockItemId);

  let best: Candidate | null = null;
  for (const block of input.blocks) {
    const fit = state.remaining(block.id, seed.cropPluginId);
    if (fit <= 0) continue;
    if (blockRuleOut(input, seed, block.id, placed, firstPart)) continue;
    const needed = partial ? Math.min(remainingPlants, fit) : remainingPlants;
    const score = scoreBlock(seed, plugin, block, needed, fit, state, input);
    if (score < floor) continue;
    if (!best || score > best.score || (score === best.score && block.id < best.blockId)) {
      best = { blockId: block.id, score, fit };
    }
  }
  return best;
}

/** R-03: a later part of a lot goes to the best-scoring block that is not
 *  ruled out and has room; ties go to a block next to one already holding
 *  part of this lot, then to more room, then to the block id. */
function laterPartBlock(
  seed: SeedRequest,
  remainingPlants: number,
  state: BlockState,
  input: PlanInput,
  placed: ReadonlyArray<Assignment>
): Candidate | null {
  const plugin = input.pluginIndex[seed.cropPluginId];
  if (!plugin) return null;
  const holding = placed.filter((a) => a.stockItemId === seed.stockItemId).map((a) => a.blockId);
  let best: (Candidate & { adjacent: boolean }) | null = null;
  for (const block of input.blocks) {
    const fit = state.remaining(block.id, seed.cropPluginId);
    if (fit <= 0) continue;
    if (blockRuleOut(input, seed, block.id, placed, false)) continue;
    const score = scoreBlock(
      seed,
      plugin,
      block,
      Math.min(remainingPlants, fit),
      fit,
      state,
      input
    );
    const myAxis = state.axis(block.id);
    const adjacent =
      !!myAxis &&
      holding.some((h) => {
        const other = state.axis(h);
        return !!other && h !== block.id && isAxisAdjacent(myAxis, other);
      });
    const cand = { blockId: block.id, score, fit, adjacent };
    if (!best || laterBetter(cand, best)) best = cand;
  }
  return best;
}

function laterBetter(
  a: Candidate & { adjacent: boolean },
  b: Candidate & { adjacent: boolean }
): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.adjacent !== b.adjacent) return a.adjacent;
  if (a.fit !== b.fit) return a.fit > b.fit;
  return a.blockId < b.blockId;
}

function scoreBlock(
  seed: SeedRequest,
  plugin: CropPlugin,
  block: BlockWithPlantings,
  needed: number,
  fit: number,
  state: BlockState,
  input: PlanInput
): number {
  const w = SCORE_WEIGHTS;
  let score = 0;

  // 1) capacity fit — proportion of *needed* this block can absorb.
  score += w.capacityFit * Math.min(1, fit / needed);

  // 2) sun match
  const want = seed.sunRequirement ?? defaultSunForFamily(plugin.cropFamily);
  const have = block.sunExposure;
  if (have !== undefined) {
    if (have === want) score += w.sunMatch;
    else if (
      (want === 'full' && have === 'partial') ||
      (want === 'partial' && (have === 'full' || have === 'shade'))
    )
      score += w.sunMatch * 0.5;
    // otherwise zero
  }

  // 3) companion: same-block + axis-adjacent placements
  const compEntry = input.companions[seed.cropPluginId];
  if (compEntry) {
    // Same block — bad pair on the same block is an outright conflict.
    for (const p of state.pluginsOn(block.id)) {
      if (compEntry.goodWith.includes(p)) score += w.companionGood;
      if (compEntry.badWith.includes(p)) score += w.companionBad;
    }
  }
  const myAxis = state.axis(block.id);
  if (myAxis && compEntry) {
    for (const other of input.blocks) {
      if (other.id === block.id) continue;
      const otherAxis = state.axis(other.id);
      if (!otherAxis) continue;
      if (!isAxisAdjacent(myAxis, otherAxis)) continue;
      for (const p of state.pluginsOn(other.id)) {
        if (compEntry.goodWith.includes(p)) score += w.companionGood;
        if (compEntry.badWith.includes(p)) score += w.companionBad;
      }
    }
  }

  // 4) shade penalty
  if (cropCastsShade(plugin) && myAxis) {
    for (const other of input.blocks) {
      if (other.id === block.id) continue;
      const otherAxis = state.axis(other.id);
      if (!otherAxis) continue;
      if (!isEastWestAdjacent(myAxis, otherAxis)) continue;
      const placedOnOther = state.pluginsOn(other.id);
      for (const p of placedOnOther) {
        const otherPlugin = input.pluginIndex[p];
        if (!otherPlugin) continue;
        const otherWantsFullSun =
          (input.companions[p]?.goodWith.length ?? 0) === 0 &&
          defaultSunForFamily(otherPlugin.cropFamily) === 'full';
        if (otherWantsFullSun) {
          score += w.shadePenalty;
          break;
        }
      }
    }
  }

  // 5) rotation lookback against existing history on this block
  const lookback = rotationLookbackForFamily(plugin.cropFamily);
  if (lookback > 0) {
    const cutoff = (input.nowMs ?? Date.now()) - lookback * 365 * 86_400_000;
    for (const c of input.existingCrops) {
      if (c.blockId !== block.id) continue;
      if (c.plantingDate == null || c.plantingDate < cutoff) continue;
      const priorPlugin = input.pluginIndex[c.cropPluginId];
      if (!priorPlugin) continue;
      if (priorPlugin.cropFamily === plugin.cropFamily) {
        score += w.rotationPenalty;
        break;
      }
    }
  }

  // 6) fragmentation — penalise needing to split this seed
  if (fit < needed) score += w.fragmentationPenalty;

  // 7) narrow-block penalty — block min-dimension < 2 × rowSpacing
  // A crop sown by area (#555) has no rows, so no block is too narrow.
  const rowIn = rowSpacingOf(plugin).inches;
  const minDimFt = blockMinDimensionFt(block);
  if (!isAreaCrop(plugin) && minDimFt != null && minDimFt < 2 * (rowIn * FT_PER_INCH)) {
    score += w.narrowBlockPenalty;
  }

  // 8) Three Sisters bonus — corn + legume + cucurbit on the same block
  const family = plugin.cropFamily;
  if (family === 'corn' || family === 'legume' || family === 'cucurbit') {
    const placedHere = state.pluginsOn(block.id);
    const families = new Set<string>();
    for (const p of placedHere) {
      const pp = input.pluginIndex[p];
      if (pp) families.add(pp.cropFamily);
    }
    families.add(family);
    if (families.has('corn') && families.has('legume') && families.has('cucurbit')) {
      score += w.threeSistersBonus;
    }
  }

  return score;
}

function isAxisAdjacent(a: BlockAxisLite, b: BlockAxisLite): boolean {
  const eastDiff = a.east != null && b.east != null ? Math.abs(a.east - b.east) : null;
  const northDiff = a.north != null && b.north != null ? Math.abs(a.north - b.north) : null;
  if (eastDiff === null && northDiff === null) return false;
  return (
    (eastDiff === 0 && northDiff === 1) ||
    (eastDiff === 1 && northDiff === 0) ||
    (eastDiff === 1 && northDiff === 1)
  );
}

function isEastWestAdjacent(a: BlockAxisLite, b: BlockAxisLite): boolean {
  if (a.east == null || b.east == null) return false;
  if (Math.abs(a.east - b.east) !== 1) return false;
  if (a.north != null && b.north != null && Math.abs(a.north - b.north) > 1) return false;
  return true;
}

function blockMinDimensionFt(block: BlockWithPlantings): number | null {
  const geo = block.geometryGeojson;
  if (!geo) {
    if (block.acres && block.acres > 0) {
      // Assume square block: side = sqrt(area). This is a safe lower bound
      // for the narrow-block check (real shapes can be narrower).
      return Math.sqrt(block.acres * SQFT_PER_ACRE);
    }
    return null;
  }
  try {
    const parsed = JSON.parse(geo) as unknown;
    const coords = extractCoords(parsed);
    if (!coords || coords.length === 0) return null;
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    const lonRange = Math.max(...lons) - Math.min(...lons);
    const latRange = Math.max(...lats) - Math.min(...lats);
    const meanLat = (Math.max(...lats) + Math.min(...lats)) / 2;
    const lonFt = lonRange * 364_488 * Math.cos((meanLat * Math.PI) / 180);
    const latFt = latRange * 364_488;
    return Math.min(Math.abs(lonFt), Math.abs(latFt));
  } catch {
    return null;
  }
}

function extractCoords(g: unknown): number[][] | null {
  if (!g || typeof g !== 'object') return null;
  const obj = g as { type?: string; coordinates?: unknown };
  if (obj.type === 'Polygon' && Array.isArray(obj.coordinates)) {
    const ring = obj.coordinates[0];
    if (Array.isArray(ring)) return ring as number[][];
  }
  if (obj.type === 'MultiPolygon' && Array.isArray(obj.coordinates)) {
    const poly = obj.coordinates[0];
    if (Array.isArray(poly) && Array.isArray(poly[0])) return poly[0] as number[][];
  }
  return null;
}

// ─── Shared beds (#440) ──────────────────────────────────────────────────

/** A fill-to-capacity crop is steered away from beds that already hold
 *  other fill crops, so several uncounted seeds spread over the beds
 *  instead of all landing on the lowest-id one. */
const FILL_CROWDING_PENALTY = 25;

/**
 * Packs seeds onto garden and greenhouse beds by area share.
 *
 * Counted seeds go first, smallest need first. Each takes what it needs
 * from its best bed, but never more than a fair split of that bed's free
 * share with the counted seeds still waiting for it (water-filling), and
 * spills onto its next best bed. A top-up sweep then gives each counted
 * seed with plants left the free share of beds that are not ruled out, with
 * no fair cap (R-09), so no free share is left unused while counted seed
 * sits in the packet. What is still left is reported.
 *
 * Uncounted (fill-to-capacity) seeds come next: each picks one bed, and the
 * free share of every bed is then split evenly among the fill seeds on it.
 */
function packSharedBeds(
  seeds: ReadonlyArray<SeedRequest>,
  beds: ReadonlyArray<BlockWithPlantings>,
  input: PlanInput,
  priorAssignments: ReadonlyArray<Assignment>
): RawResult {
  const placedAll: Assignment[] = [...priorAssignments];
  const pendingOn = new Map<string, Set<string>>();
  const pending: Assignment[] = [];
  const state = initBlockState(input, placedAll, pendingOn);
  const start = placedAll.length;

  const unplaced: SeedRequest[] = [];
  const diagnostics: PlanDiagnostic[] = [];
  const tightOrder = new Map(sortByTightness(input).map((s, i) => [s.stockItemId, i]));
  const byTightness = (a: SeedRequest, b: SeedRequest) =>
    (tightOrder.get(a.stockItemId) ?? 0) - (tightOrder.get(b.stockItemId) ?? 0);

  const free = (bedId: string) => bedFreeAfter(input, bedId, placedAll);
  const ruledOut = (seed: SeedRequest, bedId: string) =>
    seed.fillToCapacity
      ? blockRuleOut(input, seed, bedId, [...placedAll, ...pending], true) !== null
      : blockRuleOut(input, seed, bedId, placedAll, !hasPart(placedAll, seed.stockItemId)) !== null;

  interface Ranked {
    bed: BlockWithPlantings;
    score: number;
    fit: number;
    room: number;
    adjacent: boolean;
  }
  const rankBeds = (
    seed: SeedRequest,
    plugin: CropPlugin,
    needed: number,
    floor: number
  ): Ranked[] => {
    const holding = placedAll
      .filter((a) => a.stockItemId === seed.stockItemId)
      .map((a) => a.blockId);
    const ranked: Ranked[] = [];
    for (const bed of beds) {
      const fit = bedPlantsFit(bed, plugin);
      if (fit <= 0) continue;
      const room = roomFor(input, seed, bed.id, placedAll);
      if (room < 1) continue;
      if (ruledOut(seed, bed.id)) continue;
      const score = scoreBlock(seed, plugin, bed, Math.max(1, needed), room, state, input);
      if (score < floor) continue;
      const myAxis = state.axis(bed.id);
      const adjacent =
        !!myAxis &&
        holding.some((h) => {
          const other = state.axis(h);
          return !!other && h !== bed.id && isAxisAdjacent(myAxis, other);
        });
      ranked.push({ bed, score, fit, room, adjacent });
    }
    ranked.sort(
      (x, y) =>
        y.score - x.score ||
        (x.adjacent === y.adjacent ? 0 : x.adjacent ? -1 : 1) ||
        y.room - x.room ||
        (x.bed.id < y.bed.id ? -1 : 1)
    );
    return ranked;
  };

  const place = (
    seed: SeedRequest,
    bed: BlockWithPlantings,
    fit: number,
    share: number,
    cap: number
  ) => {
    const plants = Math.min(
      cap,
      plantsForShare(share, fit),
      roomFor(input, seed, bed.id, placedAll)
    );
    if (plants < 1) return 0;
    placedAll.push(part(seed, bed.id, plants, 0));
    return plants;
  };

  const counted = seeds.filter((s) => !s.fillToCapacity);
  const fills = seeds.filter((s) => s.fillToCapacity);

  // Phase 1 — counted seeds, a fair split of each bed.
  const firstChoice = new Map<string, string>();
  const contenders = new Map<string, number>();
  const needShare = new Map<string, number>();
  for (const seed of counted) {
    const plugin = input.pluginIndex[seed.cropPluginId];
    if (!plugin) continue;
    const best = rankBeds(seed, plugin, seed.quantityPlants, -Infinity)[0];
    if (!best) continue;
    firstChoice.set(seed.stockItemId, best.bed.id);
    contenders.set(best.bed.id, (contenders.get(best.bed.id) ?? 0) + 1);
    needShare.set(seed.stockItemId, seed.quantityPlants / best.fit);
  }
  const countedOrder = [...counted].sort(
    (a, b) =>
      (needShare.get(a.stockItemId) ?? Infinity) - (needShare.get(b.stockItemId) ?? Infinity) ||
      byTightness(a, b)
  );
  const remaining = new Map<string, number>();
  for (const seed of countedOrder) {
    const plugin = input.pluginIndex[seed.cropPluginId];
    const first = firstChoice.get(seed.stockItemId);
    if (first) contenders.set(first, Math.max(0, (contenders.get(first) ?? 1) - 1));
    let left = seed.quantityPlants;
    if (plugin) {
      const ranked = rankBeds(seed, plugin, left, -Infinity);
      for (const { bed, fit } of seed.keepInOneBed ? ranked.slice(0, 1) : ranked) {
        if (left <= 0) break;
        if (ruledOut(seed, bed.id)) continue;
        const fair = free(bed.id) / (1 + (contenders.get(bed.id) ?? 0));
        left -= place(seed, bed, fit, Math.min(left / fit, fair), left);
      }
    }
    remaining.set(seed.stockItemId, left);
  }

  // Top-up sweep (R-09) — the free share of every bed that is not ruled
  // out, best rank first, no fair cap.
  for (const seed of countedOrder) {
    const plugin = input.pluginIndex[seed.cropPluginId];
    if (!plugin) continue;
    let left = remaining.get(seed.stockItemId) ?? 0;
    while (left > 0) {
      const best = rankBeds(seed, plugin, left, -Infinity)[0];
      if (!best) break;
      const got = place(
        seed,
        best.bed,
        best.fit,
        Math.min(left / best.fit, free(best.bed.id)),
        left
      );
      if (got <= 0) break;
      left -= got;
    }
    remaining.set(seed.stockItemId, left);
  }

  for (const seed of counted) {
    const left = remaining.get(seed.stockItemId) ?? seed.quantityPlants;
    if (left <= 0) continue;
    unplaced.push({ ...seed, quantityPlants: left });
    const got = seed.quantityPlants - left;
    diagnostics.push({
      stockItemId: seed.stockItemId,
      cropPluginId: seed.cropPluginId,
      reason:
        got > 0
          ? `${got} of ${unitsText(seed, seed.quantityPlants)} fit; ${left} left over`
          : bedNoFitReason(seed, beds, input, placedAll)
    });
  }

  // Phase 2 — fill-to-capacity seeds.
  const fillOn = new Map<string, Array<{ seed: SeedRequest; fit: number }>>();
  for (const seed of [...fills].sort(byTightness)) {
    const plugin = input.pluginIndex[seed.cropPluginId];
    let chosen: { bed: BlockWithPlantings; fit: number } | null = null;
    let chosenScore = -Infinity;
    if (plugin) {
      for (const r of rankBeds(seed, plugin, seed.quantityPlants, MIN_SCORE_LOOSE)) {
        const s = r.score - FILL_CROWDING_PENALTY * (fillOn.get(r.bed.id)?.length ?? 0);
        if (s > chosenScore) {
          chosenScore = s;
          chosen = { bed: r.bed, fit: r.fit };
        }
      }
    }
    if (!chosen) {
      unplaced.push(seed);
      diagnostics.push({
        stockItemId: seed.stockItemId,
        cropPluginId: seed.cropPluginId,
        reason: bedNoFitReason(seed, beds, input, placedAll)
      });
      continue;
    }
    const list = fillOn.get(chosen.bed.id) ?? [];
    list.push({ seed, fit: chosen.fit });
    fillOn.set(chosen.bed.id, list);
    let on = pendingOn.get(chosen.bed.id);
    if (!on) pendingOn.set(chosen.bed.id, (on = new Set()));
    on.add(seed.cropPluginId);
    pending.push(part(seed, chosen.bed.id, 0, 0));
  }
  for (const bed of beds) {
    const list = fillOn.get(bed.id);
    if (!list) continue;
    const each = free(bed.id) / list.length;
    for (const { seed, fit } of list) {
      const share = Math.min(each, seed.quantityPlants / fit);
      if (place(seed, bed, fit, share, seed.quantityPlants) === 0) {
        unplaced.push(seed);
        diagnostics.push({
          stockItemId: seed.stockItemId,
          cropPluginId: seed.cropPluginId,
          reason: `${bed.name} is too full for another crop`
        });
      }
    }
  }

  return { assignments: placedAll.slice(start), unplaced, diagnostics };
}

function bedNoFitReason(
  seed: SeedRequest,
  beds: ReadonlyArray<BlockWithPlantings>,
  input: PlanInput,
  placed: ReadonlyArray<Assignment>
): string {
  const plugin = input.pluginIndex[seed.cropPluginId];
  if (!plugin) return 'crop plugin not registered';
  const roomy = beds.filter((b) => roomFor(input, seed, b.id, placed) > 0);
  if (roomy.length === 0) return 'every selected bed is already full';
  return 'no selected bed suits this crop (sun, rotation or a bad companion)';
}

// ─── Diagnostics ─────────────────────────────────────────────────────────

function noFitReason(seed: SeedRequest, state: BlockState, input: PlanInput): string {
  const plugin = input.pluginIndex[seed.cropPluginId];
  if (!plugin) return 'crop plugin not registered';
  let anyCapacity = false;
  let totalCapacity = 0;
  for (const block of input.blocks) {
    const r = state.remaining(block.id, seed.cropPluginId);
    if (r > 0) anyCapacity = true;
    totalCapacity += r;
  }
  if (!anyCapacity) return 'no block has remaining capacity for this crop';
  if (totalCapacity < seed.quantityPlants) {
    return `total remaining capacity ${Math.floor(totalCapacity)} < ${seed.quantityPlants} requested`;
  }
  return 'all candidate blocks scored below acceptable fit (sun, rotation, or shade conflict)';
}
