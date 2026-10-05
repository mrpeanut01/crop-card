/**
 * Phase 25d (#89) pollinator-protection gate.
 *
 * Blocks a bee-toxic spray application when any crop in the block is in
 * its declared `bloomWindow` AND `beeAttractive` is not explicitly
 * false. Used by both `/spray/insecticide` and `/spray` (herbicide) —
 * the kernel doesn't care about the chemistry class, just the bee
 * toxicity flag (`pollinatorRisk`).
 *
 * Per the v2 addendum field-by-field map, the verdict carries
 * `provenance: 'plugin'` (bloom window + bee-tox both from plugins)
 * AND `provenance: 'data'` (the current time / local weather feed in
 * a future enhancement).
 *
 * `bloomWindow` is the Phase 25c.0 (#87) discriminator — 20.5% of
 * crop plugins carry it after the deterministic backfill; the AI
 * gap-fill pass brings it to the ≥95% promotion bar. Plugins without
 * `bloomWindow` are NOT in bloom (no data = no gate).
 */

import { dateTimeFormat } from '$lib/intlCache';
import { DEFAULT_FARM_TIME_ZONE } from './animalWithdrawal';
import type { SafetyViolation } from './types';

export type PollinatorRisk = 'none' | 'low' | 'moderate' | 'high' | 'unknown';

export interface SprayedProduct {
  pluginId: string;
  pollinatorRisk?: PollinatorRisk;
}

export interface CropInBlock {
  cropPluginId: string;
  /** Ms epoch — when this planting was sown. */
  plantedAt: number;
  bloomWindow?: {
    daysFromPlantingMin?: number;
    daysFromPlantingMax?: number;
    /** 1..12 — calendar-anchored bloom (perennials). */
    monthsOfYear?: number[];
    /** True for crops blooming continuously through the season. */
    continuous?: boolean;
    /** When explicitly false, the gate skips this crop regardless of
     *  timing. Default treated as true (conservative — most crop
     *  flowers attract some pollinator). */
    beeAttractive?: boolean;
  };
}

const DAY_MS = 86_400_000;

/** Calendar month (1..12) at `now` on the farm's clock. An invalid zone
 *  falls back to the default farm zone. */
function farmMonth(now: number, timeZone: string): number {
  let f: Intl.DateTimeFormat;
  try {
    f = dateTimeFormat('en-US', { timeZone, month: 'numeric' });
  } catch {
    f = dateTimeFormat('en-US', { timeZone: DEFAULT_FARM_TIME_ZONE, month: 'numeric' });
  }
  return Number(f.formatToParts(new Date(now)).find((p) => p.type === 'month')?.value);
}

export function isInBloom(
  crop: CropInBlock,
  now: number,
  timeZone: string = DEFAULT_FARM_TIME_ZONE
): boolean {
  const bw = crop.bloomWindow;
  if (!bw) return false;
  if (bw.beeAttractive === false) return false;

  if (bw.continuous === true) {
    // Continuous bloom from first flower. Use daysFromPlantingMin as
    // the first-flower offset if declared; otherwise approximate at
    // 30 days (covers most annual continuous bloomers — cucurbit,
    // tomato, pepper).
    const minDays = bw.daysFromPlantingMin ?? 30;
    return now >= crop.plantedAt + minDays * DAY_MS;
  }

  if (bw.monthsOfYear && bw.monthsOfYear.length > 0) {
    return bw.monthsOfYear.includes(farmMonth(now, timeZone));
  }

  if (bw.daysFromPlantingMin !== undefined) {
    const min = bw.daysFromPlantingMin;
    const max = bw.daysFromPlantingMax ?? min + 30;
    const sincePlant = (now - crop.plantedAt) / DAY_MS;
    return sincePlant >= min && sincePlant <= max;
  }

  return false;
}

export function checkPollinatorBloom(
  proposed: SprayedProduct[],
  cropsInBlock: CropInBlock[],
  now: number,
  timeZone: string = DEFAULT_FARM_TIME_ZONE
): SafetyViolation[] {
  // Conservative — treat 'unknown' as risky (matches Phase 21's
  // philosophy-filter default-deny behavior for unknown compliance).
  const RISKY: PollinatorRisk[] = ['moderate', 'high', 'unknown'];
  const risky = proposed.filter((p) => RISKY.includes(p.pollinatorRisk ?? 'unknown'));
  if (risky.length === 0) return [];

  const inBloom = cropsInBlock.filter((c) => isInBloom(c, now, timeZone));
  if (inBloom.length === 0) return [];

  return [
    {
      code: 'POLLINATOR_BLOOM_BLOCK',
      message: `Bee-toxic application during bloom on ${inBloom.map((c) => c.cropPluginId).join(', ')}. Wait for bloom to end, spray at dusk after foragers have left, or rotate to a low-risk product.`,
      detail: {
        bloomingCrops: inBloom.map((c) => c.cropPluginId),
        riskyProducts: risky.map((p) => p.pluginId)
      }
    }
  ];
}
