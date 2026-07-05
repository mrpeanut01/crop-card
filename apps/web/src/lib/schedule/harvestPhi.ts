/**
 * At-harvest PHI (pre-harvest interval) check (#324, UC-14).
 *
 * When recording a harvest, we consult the recently-applied sprays on the
 * block. If the harvest date falls inside any product's PHI window, the
 * operator is WARNED (v1 decision — see below). Residue-timing is
 * label-legal information the grower is responsible for, so a hard block is
 * defensible, but for v1 we surface a clear, acknowledgeable warning rather
 * than refusing the record. The warning is non-fatal: the harvest still
 * commits.
 *
 * Pure module — no DB imports. The endpoint gathers the applied-spray facts
 * and passes them in; this reuses `isWithinPhi()` from `timeline.ts` so the
 * plan-timeline detector and this at-harvest check share one interval math.
 */

import { isWithinPhi } from './timeline';

export interface AppliedSpray {
  /** Human-readable product name for the warning line. */
  productName: string;
  /** Chemistry class label, e.g. 'herbicide' | 'insecticide' | 'fungicide'. */
  kind: string;
  /** ms epoch the spray was applied. */
  appliedMs: number;
  /** preHarvestIntervalDays declared on the applied product. */
  phiDays: number;
}

export interface PhiConflict {
  productName: string;
  kind: string;
  phiDays: number;
  appliedMs: number;
  /** ms epoch the PHI clears (appliedMs + phiDays). */
  clearsAtMs: number;
  /** Whole days remaining until the interval clears (>=1). */
  daysRemaining: number;
}

export interface HarvestPhiResult {
  /** 'safe' — no active PHI; 'warn' — at least one product still inside PHI. */
  decision: 'safe' | 'warn';
  conflicts: PhiConflict[];
  /** Operator-facing sentence when decision === 'warn'. */
  message?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Evaluate whether a harvest at `harvestMs` violates any applied product's
 * PHI. Returns a `warn` decision with per-product conflict detail when so.
 */
export function evaluateHarvestPhi(sprays: AppliedSpray[], harvestMs: number): HarvestPhiResult {
  const conflicts: PhiConflict[] = [];
  for (const s of sprays) {
    if (!isWithinPhi(s.appliedMs, s.phiDays, harvestMs)) continue;
    const clearsAtMs = s.appliedMs + s.phiDays * DAY_MS;
    conflicts.push({
      productName: s.productName,
      kind: s.kind,
      phiDays: s.phiDays,
      appliedMs: s.appliedMs,
      clearsAtMs,
      daysRemaining: Math.max(1, Math.ceil((clearsAtMs - harvestMs) / DAY_MS))
    });
  }

  if (conflicts.length === 0) return { decision: 'safe', conflicts };

  const parts = conflicts.map(
    (c) => `${c.productName} (${c.kind}, PHI ${c.phiDays}d — ${c.daysRemaining}d remaining)`
  );
  return {
    decision: 'warn',
    conflicts,
    message: `Harvest is inside the pre-harvest interval for: ${parts.join('; ')}. Verify the label PHI before selling or storing.`
  };
}
