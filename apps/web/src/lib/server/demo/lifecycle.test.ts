// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { helperAssignments, owners, users } from '$lib/db/schema';
import { getSetting } from '$lib/db/settings';
import { runWithTenant } from '$lib/db/tenant';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
import { DEMO_TTL_MS } from '$lib/demo/identity';
import type { AuthenticatedUser } from '$lib/server/auth';
import { purgeExpiredFarmlessDemoUsers } from '$lib/db/demo/purge';
import {
  createBlankDemoUser,
  demoExpiryFor,
  demoSessionExpired,
  discardDemo,
  insertDemoOwner,
  newDemoOwnerId
} from './lifecycle';

function asUser(id: string, email: string, activeOwnerId: string | null): AuthenticatedUser {
  return { id, email, phone: null, role: 'owner', activeOwnerId } as AuthenticatedUser;
}

function userExists(id: string): boolean {
  return !!db.select({ id: users.id }).from(users).where(eq(users.id, id)).get();
}

describe('Start from scratch demo', () => {
  it('creates a farmless demo user that expires on the demo clock', () => {
    const now = Date.now();
    const { userId, email } = createBlankDemoUser(now);
    const user = asUser(userId, email, null);
    expect(demoExpiryFor(user)).toBe(now + DEMO_TTL_MS);
    expect(demoSessionExpired(user, now + 1000)).toBe(false);
    expect(demoSessionExpired(user, now + DEMO_TTL_MS + 1)).toBe(true);
    expect(
      db.select().from(helperAssignments).where(eq(helperAssignments.userId, userId)).all()
    ).toEqual([]);
  });

  it('a farm made in onboarding keeps a demo id, AI off, and is erased with the demo', () => {
    const now = Date.now();
    const { userId, email } = createBlankDemoUser(now);
    const ownerId = newDemoOwnerId();
    db.transaction(() =>
      insertDemoOwner({ ownerId, userId, name: 'My Farm', slug: ownerId, createdAt: new Date(now) })
    );
    expect(runWithTenant(ownerId, () => getSetting(SETTINGS_KEYS.aiMonthlyUsdCap))).toBe('0');
    discardDemo(asUser(userId, email, ownerId));
    expect(db.select().from(owners).where(eq(owners.id, ownerId)).get()).toBeUndefined();
    expect(userExists(userId)).toBe(false);
  });

  it('refuses a non-demo owner id', () => {
    const { userId } = createBlankDemoUser();
    expect(() =>
      insertDemoOwner({
        ownerId: 'owner_real',
        userId,
        name: 'x',
        slug: 'x',
        createdAt: new Date()
      })
    ).toThrow();
  });

  it('discarding a farmless demo deletes its user', () => {
    const { userId, email } = createBlankDemoUser();
    discardDemo(asUser(userId, email, null));
    expect(userExists(userId)).toBe(false);
  });

  it('the expiry sweep deletes only expired farmless demo users', () => {
    const now = Date.now();
    const old = createBlankDemoUser(now - DEMO_TTL_MS - 60_000);
    const fresh = createBlankDemoUser(now);
    const realId = `user_real_${now}`;
    db.insert(users)
      .values({ id: realId, email: `real-${now}@example.com`, createdAt: new Date(0) })
      .run();
    purgeExpiredFarmlessDemoUsers(now, 1000);
    expect(userExists(old.userId)).toBe(false);
    expect(userExists(fresh.userId)).toBe(true);
    expect(userExists(realId)).toBe(true);
  });
});
