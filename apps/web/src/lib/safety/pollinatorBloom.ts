/**
 * Phase 25d (#89) pollinator-protection gate.
 *
 * Blocks a bee-toxic spray application when any crop in the block is in
 * its declared `bloomWindow` AND `beeAttractive` is not explicitly
 * false. Used by both `/spray/insecticide` and `/spray` (herbicide) —
 * the kernel doesn't care about the chemistry class, just the bee
 * toxicity flag (`pollinatorRisk`, raised by a label `pollinator` block
 * through `effectivePollinatorRisk`).
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

import type { SafetyViolation } from './types';
import type { PollinatorData } from './pollinatorProtection';

export type PollinatorRisk = 'none' | 'low' | 'moderate' | 'high' | 'unknown';

export type LabelPollinator = Pick<PollinatorData, 'beeToxicity' | 'bloomRestriction'>;

export interface SprayedProduct {
  pluginId: string;
  pollinatorRisk?: PollinatorRisk;
  /** Label-sourced bee data (#530). Can only make a product riskier than `pollinatorRisk`. */
  pollinator?: LabelPollinator;
}

const RISK_RANK: Record<PollinatorRisk, number> = {
  none: 0,
  low: 1,
  moderate: 2,
  unknown: 3,
  high: 4
};

const RISKY: readonly PollinatorRisk[] = ['moderate', 'high', 'unknown'];

/**
 * The legacy risk a label pollinator block implies (the mapping
 * `lib/plugins/pollinatorRiskLabel.test.ts` holds the shipped plugins to).
 * A bee-silent label with no bloom restriction settles nothing, so it
 * returns undefined and the legacy hint stands.
 */
export function riskFromLabel(p: LabelPollinator): PollinatorRisk | undefined {
  const restricted = p.bloomRestriction !== 'none';
  switch (p.beeToxicity) {
    case 'highly-toxic':
      return 'high';
    case 'toxic':
      return 'moderate';
    case 'relatively-nontoxic':
      return restricted ? 'moderate' : 'low';
    default:
      return restricted ? 'unknown' : undefined;
  }
}

/**
 * RULES_VERSION 0.7.2: the riskier of the legacy hint (missing reads as
 * `unknown`) and the label block. Label data never lowers the hint, so an
 * `unknown` or nontoxic label cannot clear a product the hint gates.
 */
export function effectivePollinatorRisk(p: SprayedProduct): PollinatorRisk {
  const legacy: PollinatorRisk = p.pollinatorRisk ?? 'unknown';
  const fromLabel = p.pollinator ? riskFromLabel(p.pollinator) : undefined;
  if (fromLabel === undefined) return legacy;
  return RISK_RANK[fromLabel] > RISK_RANK[legacy] ? fromLabel : legacy;
}

export function isRiskyForBloom(p: SprayedProduct): boolean {
  return RISKY.includes(effectivePollinatorRisk(p));
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

export function isInBloom(crop: CropInBlock, now: number): boolean {
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
    const monthNow = new Date(now).getUTCMonth() + 1; // 1..12
    return bw.monthsOfYear.includes(monthNow);
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
  now: number
): SafetyViolation[] {
  // Conservative — treat 'unknown' as risky (matches Phase 21's
  // philosophy-filter default-deny behavior for unknown compliance).
  const risky = proposed.filter(isRiskyForBloom);
  if (risky.length === 0) return [];

  const inBloom = cropsInBlock.filter((c) => isInBloom(c, now));
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
