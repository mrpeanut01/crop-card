/**
 * Phase 25d (#89) — plan_revisions repo. Tenant-scoped per CLAUDE.md
 * invariant 6.
 *
 * Every plan-commit / wizard-commit / manual edit writes a revision
 * row. The ProvenancePanel renders the chain so the user can see
 * where the current plan came from (wizard? AI refinement? manual?).
 *
 * The repo is intentionally small for the v1 MVP: insert + list-by-
 * plan + most-recent. Restore / rollback / diff land in Phase 26.
 */

import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { planRevisions } from '$lib/db/schema';
import { tenantValues, withTenant } from '$lib/db/tenant';

export type PlanRevisionSource = 'wizard' | 'manual' | 'ai-refinement';

export interface PlanRevisionInput {
  planId: string;
  source: PlanRevisionSource;
  payload: Record<string, unknown>;
  parentRevisionId?: string;
  createdByUserId?: string;
}

export interface PlanRevision {
  id: string;
  ownerId: string;
  planId: string;
  revisionNumber: number;
  source: PlanRevisionSource;
  payload: Record<string, unknown>;
  parentRevisionId: string | null;
  createdByUserId: string | null;
  createdAt: number;
}

function rowToRevision(row: typeof planRevisions.$inferSelect): PlanRevision {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
  } catch {
    payload = { __parseError: row.payloadJson };
  }
  return {
    id: row.id,
    ownerId: row.ownerId,
    planId: row.planId,
    revisionNumber: row.revisionNumber,
    source: row.source as PlanRevisionSource,
    payload,
    parentRevisionId: row.parentRevisionId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.getTime()
  };
}

/** Compute the next revision_number for a (owner, planId) pair. */
function nextRevisionNumber(planId: string): number {
  const latest = db
    .select({ revisionNumber: planRevisions.revisionNumber })
    .from(planRevisions)
    .where(withTenant(planRevisions, eq(planRevisions.planId, planId)))
    .orderBy(desc(planRevisions.revisionNumber))
    .limit(1)
    .get();
  return (latest?.revisionNumber ?? 0) + 1;
}

export function insertPlanRevision(input: PlanRevisionInput): PlanRevision {
  const row = db
    .insert(planRevisions)
    .values(
      tenantValues({
        id: randomUUID(),
        planId: input.planId,
        revisionNumber: nextRevisionNumber(input.planId),
        source: input.source,
        payloadJson: JSON.stringify(input.payload),
        parentRevisionId: input.parentRevisionId ?? null,
        createdByUserId: input.createdByUserId ?? null
      })
    )
    .returning()
    .get();
  return rowToRevision(row);
}

export function listPlanRevisions(planId: string, limit = 50): PlanRevision[] {
  return db
    .select()
    .from(planRevisions)
    .where(withTenant(planRevisions, eq(planRevisions.planId, planId)))
    .orderBy(desc(planRevisions.createdAt))
    .limit(limit)
    .all()
    .map(rowToRevision);
}

export function getLatestRevision(planId: string): PlanRevision | null {
  const row = db
    .select()
    .from(planRevisions)
    .where(withTenant(planRevisions, eq(planRevisions.planId, planId)))
    .orderBy(desc(planRevisions.revisionNumber))
    .limit(1)
    .get();
  return row ? rowToRevision(row) : null;
}
