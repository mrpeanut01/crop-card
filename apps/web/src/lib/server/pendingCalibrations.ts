/**
 * F-M / UC-10 — Helper "Send to owner" calibration staging.
 *
 * Helpers can run the 1/128-acre wizard but cannot persist the resulting GPA
 * (FR-12 owner-only). They submit the result to this table; the owner reviews
 * and approves, which calls recordCalibration() on the equipment row and
 * deletes the pending entry. Reject = delete without applying.
 *
 * Phase 18a: tenant-scoped. Listings + writes go through the tenant helpers
 * so a Helper at Farm A cannot stage a calibration that Owner B might see.
 */

import { eq, desc } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { pendingCalibrations, users } from '$lib/db/schema';
import { recordCalibration } from '$lib/db/sprayers';
import { tenantValues, tenantWhere, withTenant } from '$lib/db/tenant';

export interface PendingCalibration {
  id: string;
  equipmentId: string;
  submittedById: string;
  submittedByEmail: string;
  submittedAt: number;
  calibratedGpa: number;
  spreadInches?: number;
  ouncesCollected?: number;
  notes?: string;
}

export function submitPendingCalibration(input: {
  equipmentId: string;
  submittedById: string;
  calibratedGpa: number;
  spreadInches?: number;
  ouncesCollected?: number;
  notes?: string;
}): PendingCalibration {
  const id = `pc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.insert(pendingCalibrations)
    .values(
      tenantValues({
        id,
        equipmentId: input.equipmentId,
        submittedById: input.submittedById,
        calibratedGpa: input.calibratedGpa,
        spreadInches: input.spreadInches,
        ouncesCollected: input.ouncesCollected,
        notes: input.notes
      })
    )
    .run();
  return getPendingCalibration(id)!;
}

export function listPendingCalibrations(): PendingCalibration[] {
  const rows = db
    .select({
      id: pendingCalibrations.id,
      equipmentId: pendingCalibrations.equipmentId,
      submittedById: pendingCalibrations.submittedById,
      submittedByEmail: users.email,
      submittedAt: pendingCalibrations.submittedAt,
      calibratedGpa: pendingCalibrations.calibratedGpa,
      spreadInches: pendingCalibrations.spreadInches,
      ouncesCollected: pendingCalibrations.ouncesCollected,
      notes: pendingCalibrations.notes
    })
    .from(pendingCalibrations)
    .leftJoin(users, eq(users.id, pendingCalibrations.submittedById))
    .where(tenantWhere(pendingCalibrations))
    .orderBy(desc(pendingCalibrations.submittedAt))
    .all();
  return rows.map((r) => ({
    id: r.id,
    equipmentId: r.equipmentId,
    submittedById: r.submittedById,
    submittedByEmail: r.submittedByEmail ?? 'unknown',
    submittedAt: r.submittedAt instanceof Date ? r.submittedAt.getTime() : r.submittedAt,
    calibratedGpa: r.calibratedGpa,
    spreadInches: r.spreadInches ?? undefined,
    ouncesCollected: r.ouncesCollected ?? undefined,
    notes: r.notes ?? undefined
  }));
}

export function getPendingCalibration(id: string): PendingCalibration | null {
  const all = listPendingCalibrations();
  return all.find((p) => p.id === id) ?? null;
}

/** Owner approval — applies the GPA to the sprayer and deletes the pending row. */
export function approvePendingCalibration(id: string): void {
  const pending = getPendingCalibration(id);
  if (!pending) return;
  recordCalibration(pending.equipmentId, pending.calibratedGpa);
  db.delete(pendingCalibrations)
    .where(withTenant(pendingCalibrations, eq(pendingCalibrations.id, id)))
    .run();
}

export function rejectPendingCalibration(id: string): void {
  db.delete(pendingCalibrations)
    .where(withTenant(pendingCalibrations, eq(pendingCalibrations.id, id)))
    .run();
}
