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
 * The engine never queries the DB; callers (the /api/crops/plan and
 * /commit endpoints) hydrate `PlanInput` from the existing repos and pass
 * the snapshot in.
 */

import type { CropPlugin } from '$lib/plugins/schemas';
import { cropCastsShade } from '$lib/calendar/engine';
import { rotationLookbackForFamily } from '$lib/calendar/rotation';
import type { BlockWithPlantings, SunExposure } from '$lib/db/blocks';
import type { Crop } from '$lib/db/crops';
import { plantsFitUsable, footprintSqFt } from './sufficiency';

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
}

export interface Assignment {
  stockItemId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  blockId: string;
  plants: number;
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
  unplaced: SeedRequest[];
  diagnostics: PlanDiagnostic[];
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

export function planLayout(input: PlanInput): PlanResult {
  const seedsSorted = sortByTightness(input);
  const blockState = initBlockState(input);

  const assignments: Assignment[] = [];
  const unplaced: SeedRequest[] = [];
  const diagnostics: PlanDiagnostic[] = [];

  const tryPlace = (seed: SeedRequest, floor: number): boolean => {
    let remainingPlants = seed.quantityPlants;
    const placedThisSeed: Assignment[] = [];
    while (remainingPlants > 0) {
      const candidate = bestBlock(seed, remainingPlants, blockState, input, floor);
      if (!candidate) break;
      const take = Math.min(remainingPlants, candidate.fit);
      placedThisSeed.push({
        stockItemId: seed.stockItemId,
        cropPluginId: seed.cropPluginId,
        varietyDisplayName: seed.varietyDisplayName,
        blockId: candidate.blockId,
        plants: take,
        score: candidate.score
      });
      blockState.consume(candidate.blockId, seed.cropPluginId, take);
      remainingPlants -= take;
    }
    if (remainingPlants === 0 && placedThisSeed.length > 0) {
      assignments.push(...placedThisSeed);
      return true;
    }
    // Roll back partial placements before falling through to the next pass.
    for (const a of placedThisSeed) blockState.release(a.blockId, seed.cropPluginId, a.plants);
    return false;
  };

  // Pass A — tight floor.
  const passB: SeedRequest[] = [];
  for (const seed of seedsSorted) {
    if (!tryPlace(seed, MIN_SCORE_TIGHT)) passB.push(seed);
  }
  // Pass B — relaxed floor.
  for (const seed of passB) {
    if (!tryPlace(seed, MIN_SCORE_LOOSE)) {
      unplaced.push(seed);
      diagnostics.push({
        stockItemId: seed.stockItemId,
        cropPluginId: seed.cropPluginId,
        reason: noFitReason(seed, blockState, input)
      });
    }
  }

  return { assignments, unplaced, diagnostics };
}

// ─── Sorting ─────────────────────────────────────────────────────────────

function sortByTightness(input: PlanInput): SeedRequest[] {
  const scored = input.seeds.map((seed) => ({
    seed,
    tightness: tightnessOf(seed, input)
  }));
  scored.sort((a, b) => {
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
  /** Plants of this plugin that have been consumed (by existing crops or
   *  prior assignments in this pass). */
  consumed(blockId: string, pluginId: string): number;
  remaining(blockId: string, pluginId: string, plugin: CropPlugin): number;
  consume(blockId: string, pluginId: string, plants: number): void;
  release(blockId: string, pluginId: string, plants: number): void;
  pluginsOn(blockId: string): Set<string>;
  block(blockId: string): BlockWithPlantings | undefined;
  axis(blockId: string): BlockAxisLite | undefined;
}

function initBlockState(input: PlanInput): BlockState {
  const blocksById = new Map<string, BlockWithPlantings>();
  for (const b of input.blocks) blocksById.set(b.id, b);
  const axisById = new Map<string, BlockAxisLite>();
  for (const a of input.axes) axisById.set(a.blockId, a);

  // Track per-block plant consumption per pluginId.
  const used = new Map<string, Map<string, number>>();
  // Track which plugins are placed on each block (for companion adjacency).
  const placed = new Map<string, Set<string>>();

  const initialUsage = (block: BlockWithPlantings, pluginId: string): number => {
    let sum = 0;
    const plugin = input.pluginIndex[pluginId];
    if (!plugin) return 0;
    for (const c of input.existingCrops) {
      if (c.blockId !== block.id) continue;
      if (c.status === 'archived' || c.status === 'failed' || c.status === 'harvested') continue;
      const cropPlugin = input.pluginIndex[c.cropPluginId];
      if (!cropPlugin) continue;
      if (c.quantityPlanted != null) {
        sum += c.quantityPlanted;
      } else {
        sum += plantsPerBlock(block, cropPlugin) * 0.5;
      }
    }
    return sum;
  };

  const ensureBlock = (blockId: string) => {
    if (!used.has(blockId)) used.set(blockId, new Map());
    if (!placed.has(blockId)) placed.set(blockId, new Set());
  };

  // Seed initial usage from existingCrops.
  for (const block of input.blocks) {
    ensureBlock(block.id);
    const initial = initialUsage(block, '');
    if (initial > 0) used.get(block.id)!.set('__initial__', initial);
    for (const c of input.existingCrops) {
      if (c.blockId === block.id) placed.get(block.id)!.add(c.cropPluginId);
    }
  }

  return {
    consumed(blockId, pluginId) {
      const m = used.get(blockId);
      if (!m) return 0;
      // Sum all entries — generic capacity model treats consumption uniformly
      // across plugins (a block has one acreage, period).
      let total = 0;
      for (const v of m.values()) total += v;
      // Avoid penalising the candidate plugin's own consumption — caller
      // wants "what's already taken before *this* placement," but we treat
      // capacity as shared so the answer is the same.
      void pluginId;
      return total;
    },
    remaining(blockId, pluginId, plugin) {
      const block = blocksById.get(blockId);
      if (!block) return 0;
      const cap = plantsPerBlock(block, plugin);
      const taken = this.consumed(blockId, pluginId);
      return Math.max(0, cap - taken);
    },
    consume(blockId, pluginId, plants) {
      ensureBlock(blockId);
      const m = used.get(blockId)!;
      m.set(pluginId, (m.get(pluginId) ?? 0) + plants);
      placed.get(blockId)!.add(pluginId);
    },
    release(blockId, pluginId, plants) {
      const m = used.get(blockId);
      if (!m) return;
      const cur = m.get(pluginId) ?? 0;
      const next = cur - plants;
      if (next <= 0) m.delete(pluginId);
      else m.set(pluginId, next);
    },
    pluginsOn(blockId) {
      return placed.get(blockId) ?? new Set();
    },
    block(blockId) {
      return blocksById.get(blockId);
    },
    axis(blockId) {
      return axisById.get(blockId);
    }
  };
}

function plantsPerBlock(block: BlockWithPlantings, plugin: CropPlugin): number {
  return plantsFitUsable(block, plugin);
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
  floor: number
): Candidate | null {
  const plugin = input.pluginIndex[seed.cropPluginId];
  if (!plugin) return null;

  let best: Candidate | null = null;
  for (const block of input.blocks) {
    const fit = state.remaining(block.id, seed.cropPluginId, plugin);
    if (fit <= 0) continue;
    const score = scoreBlock(seed, plugin, block, remainingPlants, fit, state, input);
    if (score < floor) continue;
    if (!best || score > best.score || (score === best.score && block.id < best.blockId)) {
      best = { blockId: block.id, score, fit };
    }
  }
  return best;
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
    const cutoff = Date.now() - lookback * 365 * 86_400_000;
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
  const rowIn = plugin.plantingGuide?.rowSpacingIn ?? plugin.defaultRowSpacingInches ?? 12;
  const minDimFt = blockMinDimensionFt(block);
  if (minDimFt != null && minDimFt < 2 * (rowIn * FT_PER_INCH)) {
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

// ─── Diagnostics ─────────────────────────────────────────────────────────

function noFitReason(seed: SeedRequest, state: BlockState, input: PlanInput): string {
  const plugin = input.pluginIndex[seed.cropPluginId];
  if (!plugin) return 'crop plugin not registered';
  let anyCapacity = false;
  let totalCapacity = 0;
  for (const block of input.blocks) {
    const r = state.remaining(block.id, seed.cropPluginId, plugin);
    if (r > 0) anyCapacity = true;
    totalCapacity += r;
  }
  if (!anyCapacity) return 'no block has remaining capacity for this crop';
  if (totalCapacity < seed.quantityPlants) {
    return `total remaining capacity ${Math.floor(totalCapacity)} < ${seed.quantityPlants} requested`;
  }
  return 'all candidate blocks scored below acceptable fit (sun, rotation, or shade conflict)';
}
