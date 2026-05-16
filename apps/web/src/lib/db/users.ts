/**
 * Users + helper-assignments repo (Phase 18a).
 *
 * Users are a GLOBAL table — a single identity may belong to multiple
 * Owners. Queries here intentionally bypass `tenantWhere`; the assignment
 * table is the bridge from cross-tenant identity to per-tenant access.
 *
 * Phase 18a adds:
 *   - `assignmentsForUser(userId)` — which Owners can this user act for?
 *   - `usersForOwner(ownerId)` — who has access to this Owner?
 *   - `addAssignment` / `revokeAssignment` — invitation acceptance / revocation
 */

import { and, eq } from 'drizzle-orm';
import { db } from './client';
import { helperAssignments, users } from './schema';
import { unscopedQueryNote } from './tenant';

const SYSTEM_USER_ID = 'system';

export async function ensureSystemUser(): Promise<{ id: string; email: string; role: string }> {
  unscopedQueryNote('users table is global identity, not tenant-scoped');
  const existing = db.select().from(users).where(eq(users.id, SYSTEM_USER_ID)).get();
  if (existing) return existing;
  const inserted = db
    .insert(users)
    .values({
      id: SYSTEM_USER_ID,
      email: 'system@cropcard.local',
      role: 'owner'
    })
    .returning()
    .get();
  return inserted;
}

// ─── Helper assignments (Phase 18a) ─────────────────────────────────────

export interface AssignmentRow {
  ownerId: string;
  userId: string;
  roleWithinOwner: 'owner' | 'helper' | 'inspector' | 'custom-operator';
  invitedByUserId?: string;
  acceptedAt?: number;
  status: 'active' | 'pending' | 'revoked';
  createdAt: number;
}

function rowToAssignment(row: typeof helperAssignments.$inferSelect): AssignmentRow {
  return {
    ownerId: row.ownerId,
    userId: row.userId,
    roleWithinOwner: row.roleWithinOwner,
    invitedByUserId: row.invitedByUserId ?? undefined,
    acceptedAt: row.acceptedAt?.getTime(),
    status: row.status,
    createdAt: row.createdAt.getTime()
  };
}

/** All active assignments for a user — drives the Owner picker. Bypasses
 *  tenantWhere on purpose; the assignment table is the bridge from
 *  cross-tenant identity to per-tenant access. */
export function activeAssignmentsForUser(userId: string): AssignmentRow[] {
  unscopedQueryNote('helper_assignments lookup is cross-tenant by design');
  return db
    .select()
    .from(helperAssignments)
    .where(eq(helperAssignments.userId, userId))
    .all()
    .filter((r) => r.status === 'active')
    .map(rowToAssignment);
}

/** Members of a specific Owner — listing for /settings/helpers. Owner-only
 *  endpoint already gates this by role; we just deliver the rows. */
export function usersForOwner(ownerId: string): AssignmentRow[] {
  unscopedQueryNote('listing assignments by owner for owner-admin UI');
  return db
    .select()
    .from(helperAssignments)
    .where(eq(helperAssignments.ownerId, ownerId))
    .all()
    .map(rowToAssignment);
}

export function addAssignment(input: {
  ownerId: string;
  userId: string;
  roleWithinOwner: AssignmentRow['roleWithinOwner'];
  invitedByUserId?: string;
}): AssignmentRow {
  unscopedQueryNote('inserting an assignment row is cross-tenant by design');
  const row = db
    .insert(helperAssignments)
    .values({
      ownerId: input.ownerId,
      userId: input.userId,
      roleWithinOwner: input.roleWithinOwner,
      invitedByUserId: input.invitedByUserId ?? null,
      acceptedAt: new Date(Date.now()),
      status: 'active'
    })
    .onConflictDoUpdate({
      target: [helperAssignments.ownerId, helperAssignments.userId],
      set: {
        roleWithinOwner: input.roleWithinOwner,
        status: 'active',
        acceptedAt: new Date(Date.now())
      }
    })
    .returning()
    .get();
  return rowToAssignment(row);
}

export function revokeAssignment(ownerId: string, userId: string): boolean {
  unscopedQueryNote('revoking an assignment is a cross-tenant write keyed by composite PK');
  const r = db
    .update(helperAssignments)
    .set({ status: 'revoked' })
    .where(
      and(eq(helperAssignments.ownerId, ownerId), eq(helperAssignments.userId, userId))
    )
    .run();
  return r.changes > 0;
}
