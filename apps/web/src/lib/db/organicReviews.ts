import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { organicTreatmentReviews } from './schema';
import { tenantValues, withTenant } from './tenant';
import { LOCK_WINDOW_MS } from './recordKinds';
import type { OrganicReviewOutcome } from '$lib/organic/apiSchemas';

export interface OrganicTreatmentReview {
  id: string;
  healthEventId: string;
  outcome: OrganicReviewOutcome;
  reason: string;
  createdBy: string | null;
  createdAt: number;
  lockedAt: number | null;
}

type Row = typeof organicTreatmentReviews.$inferSelect;

function rowTo(row: Row): OrganicTreatmentReview {
  return {
    id: row.id,
    healthEventId: row.healthEventId,
    outcome: row.outcome,
    reason: row.reason,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.getTime(),
    lockedAt: row.lockedAt ? row.lockedAt.getTime() : null
  };
}

export function getReviewForHealthEvent(healthEventId: string): OrganicTreatmentReview | undefined {
  const row = db
    .select()
    .from(organicTreatmentReviews)
    .where(
      withTenant(organicTreatmentReviews, eq(organicTreatmentReviews.healthEventId, healthEventId))
    )
    .get();
  return row ? rowTo(row) : undefined;
}

export function listOrganicReviews(): OrganicTreatmentReview[] {
  return db
    .select()
    .from(organicTreatmentReviews)
    .where(withTenant(organicTreatmentReviews))
    .all()
    .map(rowTo);
}

/** B-25: an answer locks 48 hours after it was first given. Stamps
 *  `locked_at` on the first read past the window and returns it. */
export function evaluateReviewLock(
  review: OrganicTreatmentReview,
  now = Date.now()
): number | null {
  if (review.lockedAt) return review.lockedAt;
  if (now - review.createdAt < LOCK_WINDOW_MS) return null;
  const lockedAt = review.createdAt + LOCK_WINDOW_MS;
  db.update(organicTreatmentReviews)
    .set({ lockedAt: new Date(lockedAt) })
    .where(withTenant(organicTreatmentReviews, eq(organicTreatmentReviews.id, review.id)))
    .run();
  return lockedAt;
}

/** One live review per treatment. A change keeps the first `created_at`,
 *  so the lock window never restarts. The caller checks the lock. */
export function upsertReview(input: {
  healthEventId: string;
  outcome: OrganicReviewOutcome;
  reason: string;
  createdBy: string | null;
  now?: number;
}): OrganicTreatmentReview {
  const existing = getReviewForHealthEvent(input.healthEventId);
  if (existing) {
    const row = db
      .update(organicTreatmentReviews)
      .set({ outcome: input.outcome, reason: input.reason, createdBy: input.createdBy })
      .where(withTenant(organicTreatmentReviews, eq(organicTreatmentReviews.id, existing.id)))
      .returning()
      .get();
    return rowTo(row);
  }
  const row = db
    .insert(organicTreatmentReviews)
    .values(
      tenantValues({
        id: randomUUID(),
        healthEventId: input.healthEventId,
        outcome: input.outcome,
        reason: input.reason,
        createdBy: input.createdBy,
        createdAt: new Date(input.now ?? Date.now())
      })
    )
    .returning()
    .get();
  return rowTo(row);
}
