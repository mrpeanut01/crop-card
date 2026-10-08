import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { helperAssignments, ownerSubscriptions, owners, userHints, users } from '$lib/db/schema';
import { runWithTenant, unscopedQueryNote } from '$lib/db/tenant';
import { DEMO_FARM_NAME, seedDemoFarm } from '$lib/db/demo/seed';
import {
  countDemoOwners,
  deleteFarmlessDemoUser,
  purgeDemoOwner,
  purgeExpiredDemoOwners,
  purgeExpiredFarmlessDemoUsers
} from '$lib/db/demo/purge';
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
import { getSetting, setSetting } from '$lib/db/settings';
import { realNow, runShifted } from '$lib/server/clock';
import {
  DEMO_CLOCK_OFFSET_KEY,
  DEMO_FARM_KIND_KEY,
  fastForwardOffset,
  parseOffset,
  type DemoFarmKind,
  type FastForwardChoice
} from '$lib/demo/fastForward';
import { SETTINGS_KEYS } from '$lib/schedule/constants';
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

function newDemoToken(): string {
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

function insertDemoUser(
  token: string,
  createdAt: Date,
  locale?: string | null
): { userId: string; email: string } {
  const userId = `user_demo_${token}`;
  const email = `visitor-${token}@${DEMO_EMAIL_DOMAIN}`;
  unscopedQueryNote('demo start writes the new demo user and its seen hints');
  db.insert(users)
    .values({
      id: userId,
      email,
      displayName: demoLocalizer(locale)('Demo visitor'),
      ...(locale && locale !== 'en' ? { locale } : {}),
      createdAt
    })
    .run();
  for (const hintKey of DEMO_SEEN_HINTS) {
    db.insert(userHints).values({ userId, hintKey, seenAt: createdAt }).run();
  }
  return { userId, email };
}

/** The owner, membership and plan rows of an empty demo farm. Onboarding
 *  calls this for a "Start from scratch" visitor so the farm they create
 *  still carries a demo id, expires on the demo clock and has AI off. */
export function insertDemoOwner(input: {
  ownerId: string;
  userId: string;
  name: string;
  slug: string;
  createdAt: Date;
  kind: DemoFarmKind;
  offsetMs?: number;
}): void {
  const { ownerId, userId, name, slug, createdAt, kind, offsetMs = 0 } = input;
  if (!isDemoOwnerId(ownerId)) throw new Error('insertDemoOwner: not a demo owner id');
  unscopedQueryNote('demo start writes the new demo owner, membership and plan rows');
  db.insert(owners)
    .values({
      id: ownerId,
      name,
      slug,
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
  runWithTenant(ownerId, () => {
    setSetting(SETTINGS_KEYS.aiMonthlyUsdCap, '0');
    setSetting(DEMO_FARM_KIND_KEY, kind);
    if (offsetMs > 0) setSetting(DEMO_CLOCK_OFFSET_KEY, String(offsetMs));
  });
}

/** A new demo owner id for a visitor who started from scratch. */
export function newDemoOwnerId(): string {
  return `${DEMO_OWNER_PREFIX}${newDemoToken()}`;
}

/** Creates the user, farm, membership and plan rows for one visitor and
 *  fills the farm. A seed failure removes the half-built farm. `now` is the
 *  real time; with `offsetMs` the farm is built as it would look that far
 *  ahead and keeps that offset as its clock. `createdAt` (real time) keeps
 *  the demo's expiry when a farm is rebuilt. */
export function createDemoFarm(
  now = realNow(),
  locale?: string | null,
  opts: { offsetMs?: number; createdAt?: number } = {}
): {
  ownerId: string;
  userId: string;
  email: string;
} {
  const offsetMs = opts.offsetMs ?? 0;
  const token = newDemoToken();
  const ownerId = `${DEMO_OWNER_PREFIX}${token}`;
  const createdAt = new Date(opts.createdAt ?? now);
  const { userId, email } = db.transaction(() => {
    const u = insertDemoUser(token, createdAt, locale);
    insertDemoOwner({
      ownerId,
      userId: u.userId,
      name: DEMO_FARM_NAME,
      slug: `demo-${token}`,
      createdAt,
      kind: 'sample',
      offsetMs
    });
    return u;
  });
  try {
    runShifted(offsetMs, () =>
      runWithTenant(ownerId, () =>
        seedDemoFarm({ ownerId, userId, now: now + offsetMs, anchor: createdAt.getTime(), locale })
      )
    );
  } catch (err) {
    purgeDemoOwner(ownerId);
    throw err;
  }
  return { ownerId, userId, email };
}

/** A "Start from scratch" visitor: a demo user with no farm yet, so the
 *  app opens on onboarding like a new sign-up. */
export function createBlankDemoUser(
  now = realNow(),
  locale?: string | null
): { userId: string; email: string } {
  const token = newDemoToken();
  return db.transaction(() => insertDemoUser(token, new Date(now), locale));
}

function demoUserCreatedAt(userId: string): number | null {
  unscopedQueryNote('demo expiry reads the demo user creation time by id');
  const row = db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row ? row.createdAt.getTime() : null;
}

export function purgeExpiredDemos(now = realNow(), limit = 25): number {
  return purgeExpiredDemoOwners(now, limit) + purgeExpiredFarmlessDemoUsers(now, limit);
}

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
  if (!user || !isDemoUser(user)) return null;
  if (!user.activeOwnerId) {
    const created = demoUserCreatedAt(user.id);
    return created === null ? null : demoExpiresAt(created);
  }
  if (!isDemoOwnerId(user.activeOwnerId)) return null;
  const created = demoOwnerCreatedAt(user.activeOwnerId);
  return created === null ? null : demoExpiresAt(created);
}

/** A demo cookie can outlive its farm (a re-minted cookie keeps the normal
 *  lifetime), so every demo request checks the farm's own clock. */
export function demoSessionExpired(user: AuthenticatedUser, now = realNow()): boolean {
  if (!isDemoUser(user)) return false;
  if (user.activeOwnerId && !isDemoOwnerId(user.activeOwnerId)) return true;
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
  | { ok: true; ownerId: string | null }
  | { ok: false; reason: 'disabled' | 'rate-limited' | 'busy' };

/** Starts a fresh demo farm for this browser and signs it in. A visitor
 *  already on a demo farm gets that farm deleted first (Reset). With
 *  `blank`, no farm is made: the visitor lands on onboarding and builds
 *  their own (Start from scratch). */
export function startDemo(
  event: RequestEvent,
  now = realNow(),
  opts: { blank?: boolean } = {}
): StartDemoResult {
  if (!demoEnabled()) return { ok: false, reason: 'disabled' };
  const current = event.locals.user;
  if (!current || !isDemoUser(current)) {
    if (!startLimiter.tryTake(clientKey(event), now)) return { ok: false, reason: 'rate-limited' };
  }
  purgeExpiredDemos(now, 10);
  if (current && isDemoUser(current)) discardDemo(current);
  if (countDemoOwners() >= maxDemoFarms()) return { ok: false, reason: 'busy' };
  if (opts.blank) {
    const { userId, email } = createBlankDemoUser(now, event.locals.locale);
    writeSession(
      event.cookies,
      { id: userId, email, phone: null, activeOwnerId: null, activeRole: 'owner' },
      DEMO_TTL_MS
    );
    return { ok: true, ownerId: null };
  }
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

/** Deletes the visitor's demo farm, or their farmless demo user when they
 *  started from scratch and have not named a farm yet. */
export function discardDemo(user: AuthenticatedUser): void {
  if (!isDemoUser(user)) return;
  try {
    if (isDemoOwnerId(user.activeOwnerId)) purgeDemoOwner(user.activeOwnerId!);
    else if (!user.activeOwnerId) deleteFarmlessDemoUser(user.id);
  } catch (err) {
    console.error('[demo] failed to purge demo farm on exit', err);
  }
}

/** Leaves the demo: deletes the farm now rather than at expiry. */
export function endDemo(event: RequestEvent): void {
  const user = event.locals.user;
  if (user) discardDemo(user);
  clearSession(event.cookies);
}

export interface DemoFarmState {
  kind: DemoFarmKind | null;
  offsetMs: number;
}

/** The demo farm's kind and how far its clock runs ahead (0 for any id that
 *  is not a demo farm). */
export function demoFarmState(ownerId: string | null | undefined): DemoFarmState {
  if (!isDemoOwnerId(ownerId)) return { kind: null, offsetMs: 0 };
  return runWithTenant(ownerId!, () => {
    const kind = getSetting(DEMO_FARM_KIND_KEY);
    return {
      kind: kind === 'sample' || kind === 'scratch' ? kind : null,
      offsetMs: parseOffset(getSetting(DEMO_CLOCK_OFFSET_KEY))
    };
  });
}

export type FastForwardResult =
  { ok: true; offsetMs: number } | { ok: false; reason: 'not-demo' | 'too-far' };

/** Moves a demo farm's date forward. The sample farm is rebuilt as it would
 *  look on the new date (the visitor's changes go, as with Reset); a farm
 *  the visitor built from scratch keeps everything and only its clock moves.
 *  The demo's expiry stays on the real clock and does not restart. */
export function fastForwardDemo(
  event: RequestEvent,
  choice: FastForwardChoice,
  now = realNow()
): FastForwardResult {
  const user = event.locals.user;
  if (!user || !isDemoUser(user) || !isDemoOwnerId(user.activeOwnerId)) {
    return { ok: false, reason: 'not-demo' };
  }
  const ownerId = user.activeOwnerId!;
  const state = demoFarmState(ownerId);
  const offsetMs = fastForwardOffset(choice, now, state.offsetMs);
  if (offsetMs === null) return { ok: false, reason: 'too-far' };
  const expiry = demoExpiryFor(user);
  if (expiry === null) return { ok: false, reason: 'not-demo' };

  if (state.kind !== 'sample') {
    runWithTenant(ownerId, () => setSetting(DEMO_CLOCK_OFFSET_KEY, String(offsetMs)));
    return { ok: true, offsetMs };
  }

  discardDemo(user);
  const created = createDemoFarm(now, event.locals.locale, {
    offsetMs,
    createdAt: expiry - DEMO_TTL_MS
  });
  writeSession(
    event.cookies,
    {
      id: created.userId,
      email: created.email,
      phone: null,
      activeOwnerId: created.ownerId,
      activeRole: 'owner'
    },
    Math.max(60_000, expiry - now)
  );
  return { ok: true, offsetMs };
}
