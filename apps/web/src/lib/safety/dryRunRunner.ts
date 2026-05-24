/**
 * Phase 25d (#89) — single-line evaluator wrapper that handles the
 * KERNEL_DRY_RUN gate uniformly.
 *
 * Wraps each new evaluator (fracRotation, ipmThreshold, pollinatorBloom)
 * so the record-endpoint integration looks like:
 *
 *   const fracViolations = runEvaluator('fracRotation', () =>
 *     checkFracRotation(proposed, prior),
 *     { plannedSpray, blockId }
 *   );
 *   if (fracViolations.length > 0) {
 *     // emit kernel-verdict response
 *   }
 *
 * When `isDryRunActive()` is true, runs the evaluator + logs to
 * `kernel_dry_run_log` but ALWAYS returns [] (no real block). After the
 * 14-day window per #87 step 6, flip KERNEL_DRY_RUN=0 to let verdicts
 * propagate.
 */

import type { SafetyViolation } from './types';
import { isDryRunActive, recordDryRun, type DryRunEvaluator } from './dryRunLog';

export interface RunEvaluatorContext {
  plannedSpray: Record<string, unknown>;
  blockId?: string;
}

export function runEvaluator(
  evaluator: DryRunEvaluator,
  evaluate: () => SafetyViolation[],
  ctx: RunEvaluatorContext
): SafetyViolation[] {
  const violations = evaluate();
  if (isDryRunActive()) {
    recordDryRun({
      evaluator,
      violations,
      plannedSpray: ctx.plannedSpray,
      blockId: ctx.blockId
    });
    return [];
  }
  return violations;
}
