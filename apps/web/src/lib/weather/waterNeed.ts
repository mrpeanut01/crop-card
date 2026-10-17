/**
 * A bed's watering need from the crops in it (Phase 37E, R-10). Pure and
 * client-safe. The need is words beside the verdict and never changes it:
 * the bed keeps the Area's weekly target.
 */

import type { WaterNeed } from '$lib/plugins/schemas';

export type { WaterNeed };

/** `mixed` when the bed's crops differ; the highest need then wins. */
export type BedNeedLine = WaterNeed | 'mixed' | null;

export interface BedNeed {
  line: BedNeedLine;
  /** The need the bed goes by: the only one, or the highest when mixed. */
  level: WaterNeed | null;
  /** Crops at `level`, by plugin id, in the order given. */
  cropPluginIds: string[];
}

const RANK: Record<WaterNeed, number> = { low: 0, medium: 1, high: 2 };

export const UNKNOWN_NEED: BedNeed = { line: null, level: null, cropPluginIds: [] };

/** Known only when every crop in the bed has a sourced need; one crop with
 *  no need could be the thirsty one, so the bed then reads not known. */
export function bedNeed(
  crops: ReadonlyArray<{ cropPluginId: string; waterNeed: WaterNeed | null | undefined }>
): BedNeed {
  if (crops.length === 0) return UNKNOWN_NEED;
  const levels: WaterNeed[] = [];
  for (const c of crops) {
    if (!c.waterNeed) return UNKNOWN_NEED;
    levels.push(c.waterNeed);
  }
  const level = levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
  const mixed = new Set(levels).size > 1;
  const ids = [...new Set(crops.filter((c) => c.waterNeed === level).map((c) => c.cropPluginId))];
  return { line: mixed ? 'mixed' : level, level, cropPluginIds: ids };
}
