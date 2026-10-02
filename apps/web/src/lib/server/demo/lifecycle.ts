import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { helperAssignments, ownerSubscriptions, owners, userHints, users } from '$lib/db/schema';
import { runWithTenant, unscopedQueryNote } from '$lib/db/tenant';
import { DEMO_FARM_NAME, seedDemoFarm } from '$lib/db/demo/seed';
import { countDemoOwners, purgeDemoOwner, purgeExpiredDemoOwners } from '$lib/db/demo/purge';
import {
  DEMO_EMAIL_DOMAIN,
  DEMO_OWNER_PREFIX,
  DEMO_TTL_MS,
  demoExpiresAt,
  isDemoEmail,
  isDemoOwnerId
} from '$lib/demo/identity';
import { demoLocalizer } from '$lib/demo/localize';
import { createSendLimiter } from '$lib/server/sendLimiter';
import { clearSession, writeSession } from '$lib/server/session';
import type { AuthenticatedUser } from '$lib/server/auth';

/** Hints a demo visitor should not have to dismiss on every fresh farm. */
const DEMO_SEEN_HINTS = ['alpha_welcome'] as const;

export function demoEnabled(): boolean {
  return (process.env.DEMO_MODE ?? 'on').toLowerCase() !== 'off';
}

/** Live demo farms at once. Each is a few hundred rows; the cap keeps a
 *  scripted burst from filling the database. */
export function maxDemoFarms(): number {
  const n = Number(process.env.DEMO_MAX_FARMS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 300;
}

const startLimiter = createSendLimiter([
  { ms: 10 * 60 * 1000, max: 6 },
  { ms: 60 * 60 * 1000, max: 15 }
]);

export function resetDemoLimiterForTest(): void {
  startLimiter.reset();
}

export function isDemoUser(user: Pick<AuthenticatedUser, 'email'> | null | undefined): boolean {
  return !!user && isDemoEmail(user.email);
}

/** Creates the user, farm, membership and plan rows for one visitor and
 *  fills the farm. A seed failure removes the half-built farm. */
export function createDemoFarm(
  now = Date.now(),
  locale?: string | null
): {
  ownerId: string;
  userId: string;
  email: string;
} {
  const token = randomUUID().replace(/-/g, '').slice(0, 16);
  const ownerId = `${DEMO_OWNER_PREFIX}${token}`;
  const userId = `user_demo_${token}`;
  const email = `visitor-${token}@${DEMO_EMAIL_DOMAIN}`;
  const createdAt = new Date(now);
  db.transaction(() => {
    unscopedQueryNote('demo start writes the new demo user, owner, membership and plan rows');
    db.insert(users)
      .values({
        id: userId,
        email,
        displayName: demoLocalizer(locale)('Demo visitor'),
        ...(locale && locale !== 'en' ? { locale } : {}),
        createdAt
      })
      .run();
    db.insert(owners)
      .values({
        id: ownerId,
        name: DEMO_FARM_NAME,
        slug: `demo-${token}`,
        billingStatus: 'active',
        pluginOverridesRevision: 0,
        createdAt
      })
      .run();
    db.insert(helperAssignments)
      .values({
        ownerId,
        userId,
        roleWithinOwner: 'owner',
        status: 'active',
        acceptedAt: createdAt,
        createdAt
      })
      .run();
    db.insert(ownerSubscriptions)
      .values({ ownerId, planCode: 'free', status: 'active', createdAt, updatedAt: createdAt })
      .run();
    for (const hintKey of DEMO_SEEN_HINTS) {
      db.insert(userHints).values({ userId, hintKey, seenAt: createdAt }).run();
    }
  });
  try {
    runWithTenant(ownerId, () => seedDemoFarm({ ownerId, userId, now, locale }));
  } catch (err) {
    purgeDemoOwner(ownerId);
    throw err;
  }
  return { ownerId, userId, email };
}

export const purgeExpiredDemos = purgeExpiredDemoOwners;

function demoOwnerCreatedAt(ownerId: string): number | null {
  unscopedQueryNote('demo expiry reads the demo owner creation time by id');
  const row = db
    .select({ createdAt: owners.createdAt })
    .from(owners)
    .where(eq(owners.id, ownerId))
    .get();
  return row ? row.createdAt.getTime() : null;
}

/** When the visitor's demo farm will be deleted, or null when the user is
 *  not on a demo farm. */
export function demoExpiryFor(user: AuthenticatedUser | null | undefined): number | null {
  if (!user || !isDemoUser(user) || !isDemoOwnerId(user.activeOwnerId)) return null;
  const created = demoOwnerCreatedAt(user.activeOwnerId!);
  return created === null ? null : demoExpiresAt(created);
}

/** A demo cookie can outlive its farm (a re-minted cookie keeps the normal
 *  lifetime), so every demo request checks the farm's own clock. */
export function demoSessionExpired(user: AuthenticatedUser, now = Date.now()): boolean {
  if (!isDemoUser(user)) return false;
  if (!isDemoOwnerId(user.activeOwnerId)) return true;
  const expires = demoExpiryFor(user);
  return expires === null || expires <= now;
}

function clientKey(event: RequestEvent): string {
  try {
    return event.getClientAddress();
  } catch {
    return 'unknown';
  }
}

export type StartDemoResult =
  { ok: true; ownerId: string } | { ok: false; reason: 'disabled' | 'rate-limited' | 'busy' };

/** Starts a fresh demo farm for this browser and signs it in. A visitor
 *  already on a demo farm gets that farm deleted first (Reset). */
export function startDemo(event: RequestEvent, now = Date.now()): StartDemoResult {
  if (!demoEnabled()) return { ok: false, reason: 'disabled' };
  const current = event.locals.user;
  if (!current || !isDemoUser(current)) {
    if (!startLimiter.tryTake(clientKey(event), now)) return { ok: false, reason: 'rate-limited' };
  }
  purgeExpiredDemos(now, 10);
  if (current && isDemoUser(current)) endDemoFarm(current);
  if (countDemoOwners() >= maxDemoFarms()) return { ok: false, reason: 'busy' };
  const { ownerId, userId, email } = createDemoFarm(now, event.locals.locale);
  writeSession(
    event.cookies,
    {
      id: userId,
      email,
      phone: null,
      activeOwnerId: ownerId,
      activeRole: 'owner'
    },
    DEMO_TTL_MS
  );
  return { ok: true, ownerId };
}

function endDemoFarm(user: AuthenticatedUser): void {
  if (!isDemoUser(user) || !isDemoOwnerId(user.activeOwnerId)) return;
  try {
    purgeDemoOwner(user.activeOwnerId!);
  } catch (err) {
    console.error('[demo] failed to purge demo farm on exit', err);
  }
}

/** Leaves the demo: deletes the farm now rather than at expiry. */
export function endDemo(event: RequestEvent): void {
  const user = event.locals.user;
  if (user) endDemoFarm(user);
  clearSession(event.cookies);
}
