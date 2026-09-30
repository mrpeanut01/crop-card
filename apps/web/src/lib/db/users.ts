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

import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { db } from './client';
import { helperAssignments, tasks, users } from './schema';
import { unscopedQueryNote } from './tenant';
import { ASSIGNABLE_ROLES, memberName, type AssignableRole } from '$lib/tasks/assignee';

const SYSTEM_USER_ID = 'system';

export async function ensureSystemUser(): Promise<{ id: string; email: string | null }> {
  unscopedQueryNote('users table is global identity, not tenant-scoped');
  const existing = db.select().from(users).where(eq(users.id, SYSTEM_USER_ID)).get();
  if (existing) return { id: existing.id, email: existing.email };
  const inserted = db
    .insert(users)
    .values({
      id: SYSTEM_USER_ID,
      email: 'system@cropcard.local'
    })
    .returning()
    .get();
  return { id: inserted.id, email: inserted.email };
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
  fromInvite?: boolean;
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
      // An invite never demotes an active owner: accepting a helper invite
      // to one's own farm would leave it with no owner and move its hold
      // clock (review round 5).
      set: {
        roleWithinOwner: input.fromInvite
          ? sql`CASE WHEN ${helperAssignments.roleWithinOwner} = 'owner' AND ${helperAssignments.status} = 'active' THEN 'owner' ELSE ${input.roleWithinOwner} END`
          : input.roleWithinOwner,
        status: 'active',
        acceptedAt: new Date(Date.now())
      }
    })
    .returning()
    .get();
  return rowToAssignment(row);
}

/** Revokes a helper, operator or inspector. An active owner assignment is
 *  never revoked here: the farm's hold clock is the owner's saved zone
 *  (C-35), so dropping it would move every hold's midnight without the
 *  zone check (review round 7). */
/** Revokes a member. Their open tasks on this Owner go back to nobody in
 *  the same transaction (F1-6); closed tasks keep the name. */
export function revokeAssignment(ownerId: string, userId: string): boolean {
  unscopedQueryNote('revoking an assignment is a cross-tenant write keyed by composite PK');
  return db.transaction(() => {
    const r = db
      .update(helperAssignments)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(helperAssignments.ownerId, ownerId),
          eq(helperAssignments.userId, userId),
          sql`NOT (${helperAssignments.roleWithinOwner} = 'owner' AND ${helperAssignments.status} = 'active')`
        )
      )
      .run();
    if (r.changes > 0) {
      db.update(tasks)
        .set({ assigneeUserId: null, assignedAt: null })
        .where(
          and(
            eq(tasks.ownerId, ownerId),
            eq(tasks.assigneeUserId, userId),
            isNull(tasks.completedAt),
            isNull(tasks.abortedAt)
          )
        )
        .run();
    }
    return r.changes > 0;
  });
}

export interface AssignableMember {
  id: string;
  name: string;
  role: AssignableRole;
}

/** Everyone who can be given a task on this Owner (F0-11), by name. */
export function listAssignableMembers(ownerId: string): AssignableMember[] {
  unscopedQueryNote('farm members come from helper_assignments joined to global users');
  return db
    .select({
      id: users.id,
      role: helperAssignments.roleWithinOwner,
      displayName: users.displayName,
      email: users.email,
      phone: users.phone
    })
    .from(helperAssignments)
    .innerJoin(users, eq(users.id, helperAssignments.userId))
    .where(
      and(
        eq(helperAssignments.ownerId, ownerId),
        eq(helperAssignments.status, 'active'),
        inArray(helperAssignments.roleWithinOwner, [...ASSIGNABLE_ROLES])
      )
    )
    .orderBy(asc(helperAssignments.createdAt), asc(users.id))
    .all()
    .map((r) => ({
      id: r.id,
      role: r.role as AssignableRole,
      name: memberName({ email: r.email, phone: r.phone, displayName: r.displayName })
    }));
}

/** Whether anyone besides `userId` can be given tasks on this Owner. A solo
 *  farm or garden household gets no Mine/Everyone filter and no Assign. */
export function hasOtherAssignableMember(ownerId: string, userId: string): boolean {
  unscopedQueryNote('farm members come from helper_assignments for the active Owner');
  return !!db
    .select({ id: helperAssignments.userId })
    .from(helperAssignments)
    .where(
      and(
        eq(helperAssignments.ownerId, ownerId),
        eq(helperAssignments.status, 'active'),
        inArray(helperAssignments.roleWithinOwner, [...ASSIGNABLE_ROLES]),
        ne(helperAssignments.userId, userId)
      )
    )
    .limit(1)
    .get();
}

/** Display names for user ids, through `memberName` (F0-12). */
export function memberNamesByIds(ids: readonly string[]): Map<string, string> {
  unscopedQueryNote('users is the global identity table; callers pass ids from tenant rows');
  const out = new Map<string, string>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 500) {
    for (const r of db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        phone: users.phone
      })
      .from(users)
      .where(inArray(users.id, unique.slice(i, i + 500)))
      .all()) {
      out.set(r.id, memberName(r));
    }
  }
  return out;
}
