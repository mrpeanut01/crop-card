/**
 * Succession-sowing eligibility (Phase 20, C1).
 *
 * Given a finalized allocation assignment and its scheduling window from
 * `scheduleCandidacy()`, this module decides whether the block can host two
 * or more plantings of the same crop within the season — and if so, the
 * crop-family-appropriate interval between plantings.
 *
 * Eligibility is a function of:
 *   - Window length: `latestMs - earliestMs` (days)
 *   - Time-per-cycle: `DTM + bed-turnover + family-specific spacing`
 *   - Max plantings: `floor(window / time-per-cycle)`
 *
 * Output is pure data — the allocator surfaces `successionFit` to the AI
 * scheduler (C3) so it can decide whether to split a single assignment into
 * dated successions.
 */

import type { CropPlugin } from '$lib/plugins/schemas';
import type { ScheduleWindow } from './scheduleCandidacy';

const ONE_DAY_MS = 86_400_000;
const BED_TURNOVER_DAYS = 10;

/** Family-keyed succession spacing. Anything not listed → no succession. */
export const FAMILY_SUCCESSION_DAYS: Record<string, number> = {
  'leafy-green': 14,
  'root-crop': 14,
  legume: 14,
  brassica: 21,
  alliums: 21,
  'culinary-herb': 14,
  corn: 14,
  // Long-DTM fruiting crops typically can't succession in Loudoun's season.
  // Set to 0 = not eligible.
  cucurbit: 0,
  solanaceae: 0,
  'stone-fruit': 0,
  'vine-fruit': 0,
  brambles: 0,
  'small-fruit': 0,
  orchard: 0,
  forage: 0,
  'cover-crop-grass': 0,
  'cover-crop-legume': 0
};

export interface SuccessionFit {
  stockItemId: string;
  blockId: string;
  /** True when the window allows ≥2 plantings AND the family declares a
   *  non-zero succession spacing. */
  eligible: boolean;
  /** Theoretical max plantings. Clamped to 6 because beyond that, splitting
   *  is operator preference rather than agronomy. */
  maxPlantings: number;
  /** Recommended days between successive plantings. 0 when ineligible. */
  suggestedIntervalDays: number;
  /** One plain-English line the scheduler prompt + UI can show. */
  reason: string;
}

export function evaluateSuccessionFit(
  window: ScheduleWindow,
  plug: CropPlugin | undefined,
  blockId: string,
  stockItemId: string
): SuccessionFit {
  if (!plug) {
    return {
      stockItemId,
      blockId,
      eligible: false,
      maxPlantings: 1,
      suggestedIntervalDays: 0,
      reason: 'no plugin info — succession check skipped'
    };
  }
  const intervalDays = FAMILY_SUCCESSION_DAYS[plug.cropFamily] ?? 0;
  if (intervalDays === 0) {
    return {
      stockItemId,
      blockId,
      eligible: false,
      maxPlantings: 1,
      suggestedIntervalDays: 0,
      reason: `${plug.cropFamily} crops don't succession in this climate — single planting recommended`
    };
  }

  const dtm = plug.daysToMaturity?.min ?? plug.daysToMaturity?.max ?? 60;
  const cycleDays = dtm + BED_TURNOVER_DAYS;
  const windowDays = Math.max(0, (window.latestMs - window.earliestMs) / ONE_DAY_MS);
  // Each succession needs `intervalDays` of stagger from the previous PLUS
  // the first planting needs its full cycle to mature inside the window.
  const max = Math.floor((windowDays - cycleDays) / intervalDays) + 1;
  const maxClamped = Math.min(6, Math.max(1, max));

  if (maxClamped < 2) {
    return {
      stockItemId,
      blockId,
      eligible: false,
      maxPlantings: 1,
      suggestedIntervalDays: intervalDays,
      reason: `season too short to fit ${dtm} d to maturity + ${intervalDays} d succession spacing — single planting`
    };
  }
  return {
    stockItemId,
    blockId,
    eligible: true,
    maxPlantings: maxClamped,
    suggestedIntervalDays: intervalDays,
    reason: `${maxClamped} plantings @ ${intervalDays} d apart fit within the ${Math.round(windowDays)} d window (${dtm} d to maturity)`
  };
}

/** Evenly split a seed quantity across N plantings using largest-remainder
 *  rounding so the sum matches the input exactly. The first plantings get
 *  the larger remainders, which is the conventional ordering (front-load). */
export function splitQuantityForSuccession(total: number, plantings: number): number[] {
  if (plantings <= 0) return [];
  if (plantings === 1) return [total];
  const base = Math.floor(total / plantings);
  const remainder = total - base * plantings;
  const out: number[] = [];
  for (let i = 0; i < plantings; i++) {
    out.push(base + (i < remainder ? 1 : 0));
  }
  return out;
}
