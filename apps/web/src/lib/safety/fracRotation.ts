/**
 * Phase 25d (#89) FRAC rotation evaluator.
 *
 * Fungicide resistance management — blocks a proposed fungicide application
 * when its FRAC codes overlap the most-recent fungicide event on the same
 * block. The plugin field `activeIngredients[].fracCode` is the source of
 * truth (Phase 25c.0 confirmed it's already 100% populated across the 64
 * fungicide plugins).
 *
 * Per the v2 addendum field-by-field map, the resulting verdict carries
 * `provenance: 'plugin'` (deterministic from plugin data + recorded
 * history), surfaced in the spray-fungicide page's tankMixProvenance +
 * gate slot.
 *
 * Pure function — caller is responsible for fetching the prior events.
 * KERNEL_DRY_RUN-aware integration lives in `lib/safety/dryRunLog.ts`.
 */

import type { SafetyViolation } from './types';

export interface FungicideProduct {
  pluginId: string;
  /** FRAC codes derived from the plugin's `activeIngredients[].fracCode`. */
  fracCodes: string[];
}

export interface PriorFungicideApplication {
  pluginId: string;
  fracCodes: string[];
  /** Ms epoch. */
  occurredAt: number;
}

export function checkFracRotation(
  proposed: FungicideProduct[],
  priorOnBlock: PriorFungicideApplication[]
): SafetyViolation[] {
  if (priorOnBlock.length === 0 || proposed.length === 0) return [];

  // The most-recent prior application is the resistance constraint. Per
  // FRAC guidance: consecutive same-MoA applications are the main
  // failure mode; reset the clock with any different MoA in between.
  const mostRecent = priorOnBlock.reduce((a, b) => (a.occurredAt > b.occurredAt ? a : b));
  const priorFracs = new Set(mostRecent.fracCodes);

  const violations: SafetyViolation[] = [];
  for (const product of proposed) {
    const shared = product.fracCodes.filter((c) => priorFracs.has(c));
    if (shared.length === 0) continue;
    violations.push({
      code: 'FRAC_ROTATION_BLOCK',
      message: `${product.pluginId} shares FRAC code${shared.length > 1 ? 's' : ''} ${shared.join(', ')} with the most recent fungicide application (${mostRecent.pluginId}). Rotate to a different mode of action to manage resistance.`,
      detail: {
        product: product.pluginId,
        priorProduct: mostRecent.pluginId,
        sharedFracCodes: shared,
        priorOccurredAt: mostRecent.occurredAt
      }
    });
  }
  return violations;
}
