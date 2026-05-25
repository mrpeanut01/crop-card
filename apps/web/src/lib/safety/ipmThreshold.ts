/**
 * Phase 25d (#89) IPM threshold evaluator.
 *
 * Blocks a proposed insecticide application when scout observations on
 * the block don't justify it. Each insecticide plugin can declare
 * `scoutingThresholds: [{pest, metric, threshold}]`; the evaluator
 * requires AT LEAST ONE threshold to be met by the most recent scout
 * observation of that (pest, metric) combo before allowing the spray.
 *
 * Per the v2 addendum field-by-field map, the IPM gate panel carries
 * both `provenance: 'data'` (the scout count, from your records) and
 * `provenance: 'plugin'` (the threshold, from the pest plugin) — see
 * `direction-almanac-insecticide.jsx` IPM threshold gate card.
 *
 * Plugins without any `scoutingThresholds` are EXEMPT from this check
 * (no threshold declared = nothing to enforce). The 25c.0 AI gap-fill
 * pass (#87) is what brings insecticide coverage from 0% → ≥95%; once
 * promoted to required in the Zod schema, every plugin will declare at
 * least one threshold and the exempt branch becomes defensive code.
 */

import type { SafetyViolation } from './types';

export interface InsecticideScoutingThreshold {
  pest: string;
  metric: string;
  threshold: number;
}

export interface InsecticideProduct {
  pluginId: string;
  scoutingThresholds: InsecticideScoutingThreshold[];
}

export interface ScoutObservation {
  pest: string;
  metric: string;
  value: number;
  /** Ms epoch. */
  occurredAt: number;
}

export function checkIpmThreshold(
  proposed: InsecticideProduct[],
  recentScout: ScoutObservation[]
): SafetyViolation[] {
  const violations: SafetyViolation[] = [];

  for (const product of proposed) {
    // EXEMPT — no threshold declared. After 25c.0 gap-fill promotes the
    // field to required, this branch becomes defensive (no insecticide
    // plugin should reach here without thresholds).
    if (product.scoutingThresholds.length === 0) continue;

    const metAtLeastOneThreshold = product.scoutingThresholds.some((t) => {
      const latest = recentScout
        .filter((o) => o.pest === t.pest && o.metric === t.metric)
        .reduce<ScoutObservation | null>(
          (best, cur) => (best === null || cur.occurredAt > best.occurredAt ? cur : best),
          null
        );
      return latest !== null && latest.value >= t.threshold;
    });

    if (!metAtLeastOneThreshold) {
      violations.push({
        code: 'IPM_THRESHOLD_NOT_MET',
        message: `${product.pluginId} requires a scout count ≥ the action threshold for at least one declared pest. No qualifying scout observation found on this block.`,
        detail: {
          product: product.pluginId,
          thresholds: product.scoutingThresholds
        }
      });
    }
  }

  return violations;
}
