/**
 * Rotation + same-time-overlap rules for the Plan-Schedule swim-lane.
 *
 * Three distinct conflict kinds are kept separate (per design review):
 *
 *   1. same-time-overlap — two crops claiming one block in overlapping
 *      date ranges. Pure interval comparison.
 *   2. rotation-conflict — same family planted in the same block within a
 *      family-specific lookback window. Cross-season, looks at history.
 *   3. companion-conflict — adjacent-block family clashes. NOT computed
 *      here — companion logic is a follow-up that lives on the spatial
 *      map view, not the swim-lane.
 *
 * Family-specific lookbacks are a hard rule: rotation policy lives in
 * code, not in plugin JSON, so a malicious plugin can't relax it.
 */

import type { CropPlugin } from '$lib/plugins/schemas';
import { rotationLookbackForFamily } from '$lib/plugins/familyDefaults';

// B1 — rotation lookback table moved to `plugins/familyDefaults.ts`. Per-crop
// `agronomy.rotationLookbackYears` overrides the family default; engines
// holding a `CropPlugin` should prefer `resolveCropAgronomy(crop)` for the
// merged value. The thin family-only export below is kept for callers that
// only have a family string in hand.
export { rotationLookbackForFamily };

export interface RotationConflict {
  kind: 'rotation-conflict';
  blockId: string;
  candidateCropId?: string;
  candidatePluginId: string;
  candidateFamily: string;
  /** The earlier `crops` row that triggered the conflict. */
  priorCropId: string;
  priorPluginId: string;
  priorPlantingDate: number;
  lookbackYears: number;
  message: string;
}

export interface PriorCrop {
  cropId: string;
  pluginId: string;
  family: string | undefined;
  plantingDate: number;
}

export function rotationConflicts(
  blockId: string,
  candidate: { cropId?: string; pluginId: string; family: string; plantingDate: number },
  history: ReadonlyArray<PriorCrop>
): RotationConflict[] {
  const lookback = rotationLookbackForFamily(candidate.family);
  if (lookback === 0) return [];
  const cutoff = candidate.plantingDate - lookback * 365 * 86_400_000;
  const out: RotationConflict[] = [];
  for (const prior of history) {
    if (prior.cropId === candidate.cropId) continue;
    if (prior.family !== candidate.family) continue;
    if (prior.plantingDate >= candidate.plantingDate) continue;
    if (prior.plantingDate < cutoff) continue;
    out.push({
      kind: 'rotation-conflict',
      blockId,
      candidateCropId: candidate.cropId,
      candidatePluginId: candidate.pluginId,
      candidateFamily: candidate.family,
      priorCropId: prior.cropId,
      priorPluginId: prior.pluginId,
      priorPlantingDate: prior.plantingDate,
      lookbackYears: lookback,
      message: `Last ${candidate.family} here was ${new Date(prior.plantingDate).getFullYear()} — needs ${lookback}-year break.`
    });
  }
  return out;
}

export interface SameTimeOverlap {
  kind: 'same-time-overlap';
  blockId: string;
  cropIdA: string;
  cropIdB: string;
  /** Inclusive overlap range. */
  overlapStartMs: number;
  overlapEndMs: number;
}

export interface BlockBar {
  cropId: string;
  startMs: number;
  endMs: number;
}

/** Detect every overlap pair within a block. Symmetric; pair (A,B) appears
 *  once with A.cropId < B.cropId by string compare. Edge-touching ranges
 *  (A.endMs === B.startMs) are NOT overlap (a planting can hand off to the
 *  next on the same day). */
export function sameTimeOverlap(blockId: string, bars: ReadonlyArray<BlockBar>): SameTimeOverlap[] {
  const out: SameTimeOverlap[] = [];
  for (let i = 0; i < bars.length; i++) {
    for (let j = i + 1; j < bars.length; j++) {
      const a = bars[i];
      const b = bars[j];
      const start = Math.max(a.startMs, b.startMs);
      const end = Math.min(a.endMs, b.endMs);
      if (start >= end) continue;
      const [first, second] = a.cropId < b.cropId ? [a, b] : [b, a];
      out.push({
        kind: 'same-time-overlap',
        blockId,
        cropIdA: first.cropId,
        cropIdB: second.cropId,
        overlapStartMs: start,
        overlapEndMs: end
      });
    }
  }
  return out;
}

/** Convenience: derive the planting bar end-ms from a crop plugin + plant date.
 *  end = plantingDate + DTM(max) + PHI buffer. */
export function plantingBarEndMs(plantingDateMs: number, plugin: CropPlugin): number {
  const dtmMax = plugin.daysToMaturity?.max ?? plugin.daysToMaturity?.min ?? 0;
  const phi = plugin.preHarvestIntervalDays ?? 0;
  return plantingDateMs + (dtmMax + phi) * 86_400_000;
}
