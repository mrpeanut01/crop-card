// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from './client';
import { helperAssignments, owners, users } from './schema';
import { runWithTenant } from './tenant';
import { addAssignment, revokeAssignment } from './users';
import { farmTimeZone } from './userProfile';

function seed() {
  const ownerId = `assign-owner-${randomUUID()}`;
  const userId = `assign-user-${randomUUID()}`;
  db.insert(owners).values({ id: ownerId, name: ownerId, slug: ownerId }).run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@assign.test`, timeZone: 'America/Los_Angeles' })
    .run();
  addAssignment({ ownerId, userId, roleWithinOwner: 'owner' });
  return { ownerId, userId };
}

const roleOf = (ownerId: string, userId: string) =>
  db
    .select({ role: helperAssignments.roleWithinOwner })
    .from(helperAssignments)
    .where(and(eq(helperAssignments.ownerId, ownerId), eq(helperAssignments.userId, userId)))
    .get()?.role;

describe('addAssignment never demotes an active owner (review round 5)', () => {
  it('accepting a helper invite to your own farm keeps you the owner and keeps the hold clock', () => {
    const { ownerId, userId } = seed();
    expect(runWithTenant(ownerId, () => farmTimeZone())).toBe('America/Los_Angeles');
    const row = addAssignment({ ownerId, userId, roleWithinOwner: 'helper', fromInvite: true });
    expect(row.roleWithinOwner).toBe('owner');
    expect(roleOf(ownerId, userId)).toBe('owner');
    expect(runWithTenant(ownerId, () => farmTimeZone())).toBe('America/Los_Angeles');
  });

  it('still re-activates a revoked helper with the invite role', () => {
    const { ownerId } = seed();
    const helperId = `assign-helper-${randomUUID()}`;
    db.insert(users)
      .values({ id: helperId, email: `${helperId}@assign.test` })
      .run();
    addAssignment({ ownerId, userId: helperId, roleWithinOwner: 'inspector' });
    db.update(helperAssignments)
      .set({ status: 'revoked' })
      .where(and(eq(helperAssignments.ownerId, ownerId), eq(helperAssignments.userId, helperId)))
      .run();
    const row = addAssignment({
      ownerId,
      userId: helperId,
      roleWithinOwner: 'helper',
      fromInvite: true
    });
    expect(row.roleWithinOwner).toBe('helper');
    expect(row.status).toBe('active');
  });
});

describe('revokeAssignment never drops an active owner (review round 7)', () => {
  it("refuses the owner's row, keeping the farm's hold clock, and still revokes a helper", () => {
    const { ownerId, userId } = seed();
    const helperId = `assign-helper-${randomUUID()}`;
    db.insert(users)
      .values({ id: helperId, email: `${helperId}@assign.test` })
      .run();
    addAssignment({ ownerId, userId: helperId, roleWithinOwner: 'helper' });
    expect(revokeAssignment(ownerId, userId)).toBe(false);
    expect(runWithTenant(ownerId, () => farmTimeZone())).toBe('America/Los_Angeles');
    expect(revokeAssignment(ownerId, helperId)).toBe(true);
  });
});
