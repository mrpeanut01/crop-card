/**
 * Pollination layer on the candidacy matrix (Phase 19, A3).
 *
 * For an allocation request, this module identifies which (seed_a, seed_b)
 * pairs cross-pollinate, precomputes the pairwise block-distance grid the
 * allocator would consider, and converts a finalized assignment list into
 * the `PollinationConstraint[]` payload the UI + scheduler consume.
 *
 * The allocator prompt receives a compact text rendering of this layer
 * (`renderPollinationPromptSection`) so Claude can prefer pairings that
 * maximize spatial separation up to the plugin's isolation ceiling.
 */

import type { PlanInput, SeedRequest, Assignment } from '$lib/layout/engine';
import { blockDistanceFt, compassBearingFromTo, hasGeometry } from '$lib/blocks/distance';
import { pairRequirement, pluginsCross } from './pollination';
import type { PollinationConstraint } from './types';

export interface CrossingPair {
  /** Sorted stockItemId pair so equality is stable. */
  pair: [string, string];
  pairDisplayNames: [string, string];
  requiredIsolationFeet: number;
  staggerDays: number;
}

export interface PollinationLayer {
  /** Pairs of stock items that cross-pollinate within this selection. Empty
   *  array means the allocator can skip pollination work entirely. */
  pairs: CrossingPair[];
  /** Precomputed distances between every block in the input, used both for
   *  the prompt rendering and for the post-hoc constraint computation.
   *  Indexed as `${blockIdA}:${blockIdB}` with the IDs sorted lexically.
   *  `null` means at least one block lacks geometry. */
  blockDistanceFt: Record<string, number | null>;
  /** Block IDs in the selection that lack `geometryGeojson`. */
  geometryMissingBlockIds: string[];
}

const PAIR_SEP = '::';
const BLOCK_SEP = ':';

export function buildPollinationLayer(input: PlanInput): PollinationLayer {
  const pairs: CrossingPair[] = [];
  const seedById = new Map<string, SeedRequest>();
  for (const s of input.seeds) seedById.set(s.stockItemId, s);
  const seen = new Set<string>();
  const seeds = input.seeds;
  for (let i = 0; i < seeds.length; i++) {
    for (let j = i + 1; j < seeds.length; j++) {
      const a = seeds[i];
      const b = seeds[j];
      const plugA = input.pluginIndex[a.cropPluginId];
      const plugB = input.pluginIndex[b.cropPluginId];
      if (!plugA || !plugB) continue;
      if (!pluginsCross(plugA, plugB, input.pluginIndex)) continue;
      const key = [a.stockItemId, b.stockItemId].sort().join(PAIR_SEP);
      if (seen.has(key)) continue;
      seen.add(key);
      const req = pairRequirement(plugA, plugB);
      const [low, high] = [a.stockItemId, b.stockItemId].sort();
      const nameLow = seedById.get(low)?.varietyDisplayName ?? low;
      const nameHigh = seedById.get(high)?.varietyDisplayName ?? high;
      pairs.push({
        pair: [low, high],
        pairDisplayNames: [nameLow, nameHigh],
        requiredIsolationFeet: req.isolationFeet,
        staggerDays: req.staggerDays
      });
    }
  }

  const blockDistance: Record<string, number | null> = {};
  const missing = new Set<string>();
  const blocks = input.blocks;
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i; j < blocks.length; j++) {
      const a = blocks[i];
      const b = blocks[j];
      const key = [a.id, b.id].sort().join(BLOCK_SEP);
      const d = blockDistanceFt(
        { id: a.id, geometryGeojson: a.geometryGeojson },
        { id: b.id, geometryGeojson: b.geometryGeojson }
      );
      blockDistance[key] = d;
      if (!hasGeometry({ id: a.id, geometryGeojson: a.geometryGeojson })) missing.add(a.id);
      if (!hasGeometry({ id: b.id, geometryGeojson: b.geometryGeojson })) missing.add(b.id);
    }
  }

  return {
    pairs,
    blockDistanceFt: blockDistance,
    geometryMissingBlockIds: [...missing].sort()
  };
}

export function distanceBetweenBlocks(
  layer: PollinationLayer,
  blockA: string,
  blockB: string
): number | null {
  const key = [blockA, blockB].sort().join(BLOCK_SEP);
  return layer.blockDistanceFt[key] ?? null;
}

/**
 * Build a text section for the allocator prompt that surfaces:
 *   - the crossing pairs the allocator must consider
 *   - per pair, the pairwise block-distance grid sorted descending so the
 *     "maximize spacing" preference is one glance for Claude
 *   - the "geometry missing" caveat per block when relevant
 *
 * Kept terse — every line costs prompt tokens, and the matrix prompt is
 * already 3-4k. Skips entirely when there are no crossing pairs.
 */
export function renderPollinationPromptSection(layer: PollinationLayer, input: PlanInput): string {
  if (layer.pairs.length === 0) return '';

  const blockNameOf = (id: string) =>
    input.blocks.find((b) => b.id === id)?.blockLabel ??
    input.blocks.find((b) => b.id === id)?.name ??
    id;

  const lines: string[] = [];
  lines.push(
    'CROSS-POLLINATION (only for the pairs listed below — every other pair is independent):'
  );
  for (const p of layer.pairs) {
    lines.push(
      `- pair ${p.pair[0]} ⟷ ${p.pair[1]} (${p.pairDisplayNames[0]} × ${p.pairDisplayNames[1]}): ` +
        `home-scale isolation ≥ ${p.requiredIsolationFeet} ft OR temporal stagger ≥ ${p.staggerDays} d.`
    );
    const distances: Array<{ blockA: string; blockB: string; d: number | null }> = [];
    for (const ba of input.blocks) {
      for (const bb of input.blocks) {
        if (ba.id > bb.id) continue;
        const d = distanceBetweenBlocks(layer, ba.id, bb.id);
        distances.push({ blockA: ba.id, blockB: bb.id, d });
      }
    }
    distances.sort((x, y) => {
      if (x.d === null && y.d === null) return 0;
      if (x.d === null) return 1;
      if (y.d === null) return -1;
      return y.d - x.d;
    });
    const grid = distances
      .filter((x) => x.blockA !== x.blockB)
      .slice(0, 12)
      .map((x) => {
        const isol = p.requiredIsolationFeet;
        const blockA = input.blocks.find((b) => b.id === x.blockA);
        const blockB = input.blocks.find((b) => b.id === x.blockB);
        const bearing =
          blockA && blockB
            ? compassBearingFromTo(
                { id: blockA.id, geometryGeojson: blockA.geometryGeojson },
                { id: blockB.id, geometryGeojson: blockB.geometryGeojson }
              )
            : null;
        const bearingNote = bearing
          ? ` (${blockNameOf(x.blockB)} is to the ${bearing} of ${blockNameOf(x.blockA)})`
          : '';
        if (x.d === null) {
          return `    ${blockNameOf(x.blockA)} ↔ ${blockNameOf(x.blockB)}: geometry missing — can't measure${bearingNote}`;
        }
        const ok =
          x.d >= isol ? '✓ isolated' : `needs +${Math.ceil(isol - x.d)} ft (or temporal stagger)`;
        return `    ${blockNameOf(x.blockA)} ↔ ${blockNameOf(x.blockB)}: ${Math.round(x.d)} ft — ${ok}${bearingNote}`;
      });
    if (grid.length > 0) {
      lines.push('  Best block separations for this pair (sorted by distance):');
      lines.push(...grid);
    }
  }
  if (layer.geometryMissingBlockIds.length > 0) {
    const names = layer.geometryMissingBlockIds.map(blockNameOf).join(', ');
    lines.push(
      `NOTE: these blocks have no recorded geometry, so distance can't be measured — treat them as "unknown isolation" and prefer using blocks with geometry for crossing pairs: ${names}.`
    );
  }
  lines.push(
    "Preference: when assigning a crossing pair to blocks, pick the pair-of-blocks that MAXIMIZES distance up to the isolation ceiling. If no pair reaches the ceiling, you may still place them — but include them in the response's open temporal-stagger constraints so the scheduler can resolve them with planting-date offsets."
  );
  lines.push(
    'IMPORTANT — do NOT reason about wind direction or "upwind/downwind" placement. The home-scale isolation distances above are OMNIDIRECTIONAL: a 250 ft separation works equally well whether the second block is north, south, east, or west of the first. Distance + temporal stagger together fully resolve the cross-pollination constraint at this scale; commercial seed-saving wind-direction rules do NOT apply. Bearings are provided only so you can describe layout truthfully ("Block B is 75 ft east of Block A"), not so you can model pollen drift. Cardinal hints in block NAMES (e.g., "East A", "North-3") are operator labels — they may not match actual cardinal geography. Use the bearings above as the source of truth, not the names.'
  );
  return lines.join('\n');
}

/**
 * Given a finalized assignment list, derive the concrete pollination
 * constraints the UI displays and the scheduler consumes. Each crossing
 * pair turns into one constraint per (blockA, blockB) combination the pair
 * actually landed on (a pair split across multiple blocks may produce
 * multiple constraints).
 */
export function computePollinationConstraints(
  assignments: ReadonlyArray<Assignment>,
  input: PlanInput,
  layer: PollinationLayer
): PollinationConstraint[] {
  if (layer.pairs.length === 0) return [];

  const blockNameOf = (id: string) =>
    input.blocks.find((b) => b.id === id)?.blockLabel ??
    input.blocks.find((b) => b.id === id)?.name ??
    id;
  const seedNameOf = (id: string) =>
    input.seeds.find((s) => s.stockItemId === id)?.varietyDisplayName ?? id;

  const blocksByStock = new Map<string, Set<string>>();
  for (const a of assignments) {
    const set = blocksByStock.get(a.stockItemId) ?? new Set<string>();
    set.add(a.blockId);
    blocksByStock.set(a.stockItemId, set);
  }

  const out: PollinationConstraint[] = [];
  for (const p of layer.pairs) {
    const [stockA, stockB] = p.pair;
    const blocksA = blocksByStock.get(stockA);
    const blocksB = blocksByStock.get(stockB);
    if (!blocksA || !blocksB) continue;
    const seen = new Set<string>();
    for (const bA of blocksA) {
      for (const bB of blocksB) {
        const key = [bA, bB].sort().join(BLOCK_SEP);
        if (seen.has(key)) continue;
        seen.add(key);
        const distance = distanceBetweenBlocks(layer, bA, bB);
        let kind: PollinationConstraint['kind'];
        let note: string;
        if (distance === null) {
          kind = 'geometry-missing';
          note = `Couldn't check isolation between ${blockNameOf(bA)} and ${blockNameOf(bB)} — add geometry to one or both to enable the check.`;
        } else if (distance >= p.requiredIsolationFeet) {
          kind = 'isolated-spatially';
          note = `${seedNameOf(stockA)} on ${blockNameOf(bA)} is ${Math.round(distance)} ft from ${seedNameOf(stockB)} on ${blockNameOf(bB)} — far enough apart that cross-pollination isn't an issue.`;
        } else {
          kind = 'must-stagger';
          note = `${seedNameOf(stockA)} (${blockNameOf(bA)}) and ${seedNameOf(stockB)} (${blockNameOf(bB)}) are only ${Math.round(distance)} ft apart — schedule plantings ≥${p.staggerDays} d apart so their flowering windows don't overlap.`;
        }
        out.push({
          kind,
          pair: [stockA, stockB],
          pairDisplayNames: [seedNameOf(stockA), seedNameOf(stockB)],
          blockIds: [bA, bB],
          blockNames: [blockNameOf(bA), blockNameOf(bB)],
          distanceFt: distance,
          requiredIsolationFeet: p.requiredIsolationFeet,
          staggerDays: p.staggerDays,
          note
        });
      }
    }
  }
  return out;
}
