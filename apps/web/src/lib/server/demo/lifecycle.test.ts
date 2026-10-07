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
import type { RequestEvent } from '@sveltejs/kit';
import { listCrops } from '$lib/db/crops';
import { DAY_MS, ymdOf } from '$lib/demo/time';
import { realNow, runShifted } from '$lib/server/clock';
import {
  createBlankDemoUser,
  createDemoFarm,
  demoFarmState,
  fastForwardDemo,
  purgeExpiredDemos,
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
      insertDemoOwner({
        ownerId,
        userId,
        name: 'My Farm',
        slug: ownerId,
        createdAt: new Date(now),
        kind: 'scratch'
      })
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
        createdAt: new Date(),
        kind: 'scratch'
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

function fakeEvent(user: AuthenticatedUser): RequestEvent & { written: unknown[] } {
  const written: unknown[] = [];
  return {
    locals: { user, locale: 'en' },
    cookies: { set: (...a: unknown[]) => written.push(a), delete: () => {} },
    written
  } as unknown as RequestEvent & { written: unknown[] };
}

function ownerCreatedAt(id: string): number | undefined {
  return db.select().from(owners).where(eq(owners.id, id)).get()?.createdAt.getTime();
}

describe('demo fast forward', () => {
  it('rebuilds the sample farm for the new date and keeps the expiry', () => {
    const now = realNow();
    const first = createDemoFarm(now - 3_600_000);
    const user = asUser(first.userId, first.email, first.ownerId);
    const created = ownerCreatedAt(first.ownerId)!;
    expect(demoFarmState(first.ownerId)).toEqual({ kind: 'sample', offsetMs: 0 });

    const event = fakeEvent(user);
    const result = fastForwardDemo(event, { phase: 'midsummer' }, now);
    expect(result.ok).toBe(true);
    const offsetMs = (result as { offsetMs: number }).offsetMs;
    expect(ymdOf(now + offsetMs).slice(5)).toBe('07-25');

    expect(ownerCreatedAt(first.ownerId)).toBeUndefined();
    expect(userExists(first.userId)).toBe(false);
    expect(event.written).toHaveLength(1);
    const newOwner = db
      .select()
      .from(helperAssignments)
      .all()
      .map((r) => r.ownerId)
      .find(
        (id) =>
          id.startsWith('owner_demo_') &&
          id !== first.ownerId &&
          demoFarmState(id).offsetMs === offsetMs
      )!;
    expect(newOwner).toBeTruthy();
    expect(ownerCreatedAt(newOwner)).toBe(created);
    const plantings = runWithTenant(newOwner, () => listCrops());
    expect(plantings.some((c) => (c.plantingDate ?? 0) > now)).toBe(true);
  });

  it('only moves the clock on a farm built from scratch', () => {
    const now = realNow();
    const { userId, email } = createBlankDemoUser(now);
    const ownerId = newDemoOwnerId();
    db.transaction(() =>
      insertDemoOwner({
        ownerId,
        userId,
        name: 'Mine',
        slug: ownerId,
        createdAt: new Date(now),
        kind: 'scratch'
      })
    );
    const user = asUser(userId, email, ownerId);
    const week = fastForwardDemo(fakeEvent(user), { step: 'week' }, now);
    expect(week).toEqual({ ok: true, offsetMs: 7 * DAY_MS });
    expect(demoFarmState(ownerId)).toEqual({ kind: 'scratch', offsetMs: 7 * DAY_MS });
    expect(ownerCreatedAt(ownerId)).toBe(now);
    const more = fastForwardDemo(fakeEvent(user), { step: 'day' }, now);
    expect(more).toEqual({ ok: true, offsetMs: 8 * DAY_MS });
    discardDemo(user);
  });

  it('refuses a farm that is not a demo farm', () => {
    const user = asUser('u_real', 'someone@example.com', 'owner_real');
    expect(fastForwardDemo(fakeEvent(user), { step: 'day' })).toEqual({
      ok: false,
      reason: 'not-demo'
    });
  });

  it("a shifted request never expires other visitors' farms", () => {
    const now = realNow();
    const other = createBlankDemoUser(now);
    runShifted(400 * DAY_MS, () => purgeExpiredDemos());
    expect(userExists(other.userId)).toBe(true);
    discardDemo(asUser(other.userId, other.email, null));
  });
});
