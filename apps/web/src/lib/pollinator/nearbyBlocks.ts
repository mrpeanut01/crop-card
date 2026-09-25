/**
 * #130 follow-up — "nearby pollinator-attractive blocks" advisory for the
 * insecticide flow (Almanac insecticide artboard: "Active hives 0.4 mi NW").
 *
 * Advisory only: the verdict is `pass | warn`, never `block`, so it sits
 * outside the safety kernel and does not move RULES_VERSION. It warns when a
 * bee-toxic product is about to go on while another block on the farm, within
 * foraging range, carries a planting that is in bloom now or whose crop plugin
 * declares it bee-attractive. Neighbours without block geometry are listed
 * with an unknown distance and never drive the warning.
 *
 * Pure and client-safe: distances and bloom flags are computed by the caller
 * (`lib/server/pollinatorNeighbors.ts`).
 */

import type { BeeToxicity } from '$lib/safety/pollinatorProtection';

/**
 * Honey bees routinely forage 1–2 miles from the hive (and further in a
 * dearth), so a colony working a blooming neighbour is likely to cross the
 * treated block or its drift. One mile is the conservative core of that
 * range: close enough that the neighbour is realistically shared forage,
 * narrow enough that the list stays actionable on a small farm.
 */
export const NEARBY_POLLINATOR_RADIUS_FT = 5280;

export type NearbyCheckStatus = 'pass' | 'warn';
export type NearbyReason = 'in-bloom' | 'bee-attractive';

export interface NeighborCrop {
  cropPluginId: string;
  displayName?: string;
  /** Crop-plugin bloom window covers the application time. */
  inBloomNow: boolean;
  /** Crop plugin declares `bloomWindow.beeAttractive: true`. */
  beeAttractive: boolean;
}

export interface NeighborBlock {
  blockId: string;
  name: string;
  /** Centroid-to-centroid distance in feet; null when either block lacks geometry. */
  distanceFt: number | null;
  crops: NeighborCrop[];
}

export interface NearbyBlockHit {
  blockId: string;
  name: string;
  distanceFt: number | null;
  reason: NearbyReason;
  crops: string[];
}

export interface NearbyPollinatorAdvisory {
  id: 'nearby-blocks';
  status: NearbyCheckStatus;
  label: string;
  reason: string;
  radiusFt: number;
  /** Attractive neighbours within `radiusFt`, nearest first. */
  blocks: NearbyBlockHit[];
  /** Attractive neighbours with no geometry — distance unknown, listed neutrally. */
  unknownDistance: NearbyBlockHit[];
}

export interface NearbyPollinatorInput {
  beeToxicity: BeeToxicity;
  neighbors: NeighborBlock[];
  radiusFt?: number;
}

const WARN_TOXICITY: ReadonlySet<BeeToxicity> = new Set(['toxic', 'highly-toxic']);

export function formatDistance(ft: number | null): string {
  if (ft === null) return 'distance unknown';
  if (ft < 1000) return `${Math.round(ft)} ft`;
  return `${(ft / 5280).toFixed(1)} mi`;
}

function hitFor(n: NeighborBlock): NearbyBlockHit | null {
  const relevant = n.crops.filter((c) => c.inBloomNow || c.beeAttractive);
  if (relevant.length === 0) return null;
  return {
    blockId: n.blockId,
    name: n.name,
    distanceFt: n.distanceFt,
    reason: relevant.some((c) => c.inBloomNow) ? 'in-bloom' : 'bee-attractive',
    crops: Array.from(new Set(relevant.map((c) => c.displayName ?? c.cropPluginId)))
  };
}

export function checkNearbyPollinatorBlocks(
  input: NearbyPollinatorInput
): NearbyPollinatorAdvisory {
  const radiusFt = input.radiusFt ?? NEARBY_POLLINATOR_RADIUS_FT;
  const blocks: NearbyBlockHit[] = [];
  const unknownDistance: NearbyBlockHit[] = [];
  for (const n of input.neighbors) {
    const hit = hitFor(n);
    if (!hit) continue;
    if (hit.distanceFt === null || !Number.isFinite(hit.distanceFt)) {
      unknownDistance.push({ ...hit, distanceFt: null });
    } else if (hit.distanceFt <= radiusFt) {
      blocks.push(hit);
    }
  }
  blocks.sort((a, b) => (a.distanceFt ?? 0) - (b.distanceFt ?? 0));

  const radiusLabel = formatDistance(radiusFt);
  const toxic = WARN_TOXICITY.has(input.beeToxicity);
  const status: NearbyCheckStatus = toxic && blocks.length > 0 ? 'warn' : 'pass';
  let reason: string;
  if (blocks.length === 0) {
    reason = `No bloom or bee-attractive plantings on other blocks within ${radiusLabel}.`;
  } else if (!toxic) {
    reason = `${blocks.length} pollinator-attractive block(s) within ${radiusLabel}; this product is not labelled bee-toxic.`;
  } else {
    reason = `Bees foraging on ${blocks.length} nearby block(s) can reach this spray — keep drift off them, spray after foragers leave, and notify nearby beekeepers.`;
  }
  if (unknownDistance.length > 0) {
    reason += ` ${unknownDistance.length} attractive block(s) have no mapped geometry, so their distance is unknown.`;
  }
  return {
    id: 'nearby-blocks',
    status,
    label: 'Nearby pollinator blocks',
    reason,
    radiusFt,
    blocks,
    unknownDistance
  };
}
