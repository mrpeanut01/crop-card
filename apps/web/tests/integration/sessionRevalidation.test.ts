/**
 * Invariant 6: a signed cookie proves who the user was when it was minted,
 * not what they may do now. `revalidateCookieUser` re-reads membership and
 * the superadmin flag each request so revocations take effect immediately.
 */

import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { revalidateCookieUser } from '../../src/hooks.server';
import { db } from '../../src/lib/db/client';
import { owners, users } from '../../src/lib/db/schema';
import { addAssignment, revokeAssignment } from '../../src/lib/db/users';
import type { AuthenticatedUser } from '../../src/lib/server/auth';

function seed(role: 'owner' | 'helper' = 'helper', isSuperadmin = false) {
  const ownerId = `rv-owner-${randomUUID().slice(0, 8)}`;
  const userId = `rv-user-${randomUUID().slice(0, 8)}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@test`, isSuperadmin })
    .run();
  addAssignment({ ownerId, userId, roleWithinOwner: role });
  const cookieUser: AuthenticatedUser = {
    id: userId,
    email: `${userId}@test`,
    phone: null,
    role,
    activeOwnerId: ownerId,
    isSuperadmin,
    impersonating: false
  };
  return { ownerId, userId, cookieUser };
}

describe('revalidateCookieUser', () => {
  it('keeps an active member in their farm', () => {
    const { ownerId, cookieUser } = seed();
    const u = revalidateCookieUser(cookieUser);
    expect(u?.activeOwnerId).toBe(ownerId);
    expect(u?.role).toBe('helper');
  });

  it('drops a revoked helper out of the farm immediately', () => {
    const { ownerId, userId, cookieUser } = seed();
    revokeAssignment(ownerId, userId);
    const u = revalidateCookieUser(cookieUser);
    expect(u).not.toBeNull();
    expect(u?.activeOwnerId).toBeNull();
  });

  it('takes the role from the database, not the cookie', () => {
    const { ownerId, userId, cookieUser } = seed('owner');
    addAssignment({ ownerId, userId, roleWithinOwner: 'helper' });
    expect(revalidateCookieUser(cookieUser)?.role).toBe('helper');
  });

  it('cannot reach a farm the user never belonged to', () => {
    const { cookieUser } = seed();
    const other = seed();
    const u = revalidateCookieUser({ ...cookieUser, activeOwnerId: other.ownerId });
    expect(u?.activeOwnerId).toBeNull();
  });

  it('ends impersonation once the superadmin flag is withdrawn', () => {
    const { userId, cookieUser } = seed('helper', true);
    const target = seed();
    const impersonating = { ...cookieUser, activeOwnerId: target.ownerId, impersonating: true };
    expect(revalidateCookieUser(impersonating)?.activeOwnerId).toBe(target.ownerId);

    db.update(users).set({ isSuperadmin: false }).where(eq(users.id, userId)).run();
    const u = revalidateCookieUser(impersonating);
    expect(u?.isSuperadmin).toBe(false);
    expect(u?.activeOwnerId).toBeNull();
    expect(u?.impersonating).toBe(false);
  });

  it('signs out a user whose account no longer exists', () => {
    const { cookieUser } = seed();
    expect(revalidateCookieUser({ ...cookieUser, id: 'rv-missing-user' })).toBeNull();
  });
});
