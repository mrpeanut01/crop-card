/**
 * Phase 25c.0 step 6 (#87) / Phase 25d (#89) — dry-run kernel log.
 *
 * When `env.KERNEL_DRY_RUN === '1'` the new evaluators (fracRotation,
 * ipmThreshold, pollinatorBloom) write their would-have-happened
 * verdicts here INSTEAD of failing the spray. After a 14-day window
 * of clean rows post-25d ship, the flag flips off and gates go live.
 *
 * Caller pattern:
 *
 *   const violations = checkFracRotation(proposed, prior);
 *   if (isDryRunActive()) {
 *     recordDryRun({ evaluator: 'fracRotation', violations,
 *                    plannedSpray, blockId });
 *     return [];  // do not block
 *   }
 *   return violations;
 *
 * Tenant-scoped via `currentOwnerId()` (CLAUDE.md invariant 6).
 */

import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db/client';
import { kernelDryRunLog } from '$lib/db/schema';
import { currentOwnerId } from '$lib/db/tenant';
import { RULES_VERSION } from './version';
import type { SafetyViolation } from './types';

export type DryRunEvaluator = 'fracRotation' | 'ipmThreshold' | 'pollinatorBloom';

export interface DryRunRecord {
  evaluator: DryRunEvaluator;
  violations: SafetyViolation[];
  plannedSpray: Record<string, unknown>;
  blockId?: string;
}

export function isDryRunActive(): boolean {
  const flag = env.KERNEL_DRY_RUN;
  return flag === '1' || flag === 'true';
}

export function recordDryRun(input: DryRunRecord): void {
  const ownerId = currentOwnerId();
  if (!ownerId) {
    console.warn('[kernel-dry-run] no active owner context; skipping log entry');
    return;
  }
  const verdict: 'ok' | 'block' = input.violations.length === 0 ? 'ok' : 'block';
  try {
    db.insert(kernelDryRunLog)
      .values({
        id: randomUUID(),
        ownerId,
        rulesVersion: RULES_VERSION,
        evaluator: input.evaluator,
        verdict,
        reasonsJson: JSON.stringify(input.violations),
        plannedSprayJson: JSON.stringify(input.plannedSpray),
        blockId: input.blockId ?? null
      })
      .run();
  } catch (err) {
    console.error('[kernel-dry-run] failed to write log entry', err);
  }
}
