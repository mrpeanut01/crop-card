/**
 * Server-side authentication + authorization helpers.
 *
 * `requireUser` / `requireOwner` throw a SvelteKit error response that the
 * endpoint can re-throw to short-circuit. Use these on every endpoint that
 * mutates state (NFR-10 audit trail; FR-09 role-gated overrides).
 *
 * Phase 18c — the AuthenticatedUser shape carries the active Owner
 * context derived from the session cookie. Roles are checked against
 * `activeRole` (the role within `activeOwnerId`); the per-(owner, user)
 * source of truth is `helper_assignments.role_within_owner`.
 */

import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import { activeAssignmentsForUser } from '$lib/db/users';
import { normalizeEmail, normalizePhone } from '$lib/identity';
import {
  ALL_SESSION_ROLES,
  canMutate,
  isReadOnly,
  readSession,
  writeSession,
  type SessionRole
} from './session';

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  phone: string | null;
  /** Role within the active Owner context. */
  role: SessionRole;
  /** Active Owner id, or null when the session is partial (post-signin,
   *  pre-picker) or when the user has no assignments yet (signup flow). */
  activeOwnerId: string | null;
  isSuperadmin: boolean;
  impersonating: boolean;
}

export function currentUser(event: RequestEvent): AuthenticatedUser | null {
  // Phase 24 / #317 — prefer a Bearer-resolved user when hooks.server.ts
  // has already vetted one. `event.locals.user` is populated ONLY by the
  // request boundary in hooks.server.ts, either from a validated
  // `Authorization: Bearer cck_…` token (authVia === 'bearer') or from the
  // cookie session below (authVia === 'cookie'). Reading it here lets
  // mutation gates (`requireUser`/`requireOwner`/`requireMutator`) succeed
  // for Bearer agents instead of falling through to a cookie-only 401.
  // We do NOT synthesize a user from anything else — this stays exactly as
  // authenticated as "a cookie session OR a hooks-vetted Bearer user".
  if (event.locals?.authVia === 'bearer' && event.locals?.user) {
    return event.locals.user;
  }
  const session = readSession(event.cookies);
  if (!session) return null;
  return {
    id: session.userId,
    email: session.email,
    phone: session.phone,
    role: session.activeRole,
    activeOwnerId: session.activeOwnerId,
    isSuperadmin: session.isSuperadmin,
    impersonating: session.impersonating ?? false
  };
}

export function requireUser(event: RequestEvent): AuthenticatedUser {
  const u = currentUser(event);
  if (!u) throw error(401, 'authentication required');
  return u;
}

export function requireOwner(event: RequestEvent): AuthenticatedUser {
  const u = requireUser(event);
  if (u.role !== 'owner') throw error(403, 'owner role required');
  return u;
}

/** Inspector role is read-only across all surfaces; reject any mutation. */
export function requireMutator(event: RequestEvent): AuthenticatedUser {
  const u = requireUser(event);
  if (!canMutate(u.role)) throw error(403, 'inspector role is read-only');
  return u;
}

/** True when the current session has read-only permissions (inspector). */
/** Adding or removing a sign-in identity changes who can sign in as this
 *  user, so it needs the interactive cookie session: an API token must not
 *  be able to attach its own phone and then sign in with it. */
export function requireInteractiveUser(event: RequestEvent): AuthenticatedUser {
  const u = requireUser(event);
  if (event.locals?.authVia === 'bearer') {
    throw error(403, 'sign-in identities can only be changed from a signed-in browser');
  }
  if (u.impersonating) throw error(403, 'not available while impersonating');
  return u;
}

export function isInspectorSession(event: RequestEvent): boolean {
  const u = currentUser(event);
  return !!u && isReadOnly(u.role);
}

/** Superadmin gate for /admin/* endpoints. Distinct from `requireOwner` —
 *  superadmins act across tenants. */
export function requireSuperadmin(event: RequestEvent): AuthenticatedUser {
  const u = requireUser(event);
  if (!u.isSuperadmin) throw error(403, 'superadmin required');
  if (event.locals?.authVia === 'bearer') {
    throw error(403, 'superadmin actions require an interactive session');
  }
  return u;
}

/**
 * Look up or create a user by email and mint a session. The returned value
 * encodes a redirect target the caller should follow:
 *   - 'onboarding' → no assignments yet, new Owner tenant creation flow
 *   - 'picker'     → multiple active assignments, user picks which Owner
 *   - 'today'      → single assignment, full session minted
 */
export interface LoginResult {
  user: AuthenticatedUser;
  next: 'onboarding' | 'picker' | 'today' | 'admin';
}

export type LoginIdentity = { email: string } | { phone: string };

/**
 * Sign in (creating the user on first contact) by a *proven* identity:
 * a redeemed magic link / email code, a redeemed SMS code, or the
 * direct/demo email path when AUTH_MODE allows it. Phone-only users are
 * created with a null email; either identity can be linked later from
 * /settings/account.
 */
export function loginByIdentity(
  event: RequestEvent,
  identity: LoginIdentity,
  desiredRole: SessionRole = 'helper'
): LoginResult {
  if (!ALL_SESSION_ROLES.includes(desiredRole)) {
    throw error(400, `invalid role: ${desiredRole}`);
  }
  let existing: typeof users.$inferSelect | undefined;
  let insert: typeof users.$inferInsert;
  if ('email' in identity) {
    const email = normalizeEmail(identity.email);
    if (!email) throw error(400, 'invalid email');
    existing = db.select().from(users).where(eq(users.email, email)).get();
    insert = { id: newUserId(), email };
  } else {
    const phone = normalizePhone(identity.phone);
    if (!phone) throw error(400, 'invalid phone number');
    existing = db.select().from(users).where(eq(users.phone, phone)).get();
    insert = { id: newUserId(), phone };
  }
  const row =
    existing ??
    (db.insert(users).values(insert).returning().get() as typeof users.$inferSelect);
  return startSession(event, row);
}

export function loginByEmail(
  event: RequestEvent,
  email: string,
  desiredRole: SessionRole = 'helper'
): LoginResult {
  return loginByIdentity(event, { email }, desiredRole);
}

function newUserId(): string {
  return `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Mint the session for a user row and pick the post-login destination.
 *  Also used after linking a new email/phone so the cookie reflects it. */
export function startSession(
  event: RequestEvent,
  row: { id: string; email: string | null; phone: string | null; isSuperadmin: boolean }
): LoginResult {
  const identity = { id: row.id, email: row.email, phone: row.phone };
  const isSuperadmin = !!row.isSuperadmin;
  const assignments = activeAssignmentsForUser(row.id);

  if (assignments.length === 0) {
    writeSession(event.cookies, { ...identity, isSuperadmin, activeOwnerId: null, activeRole: 'owner' });
    return {
      user: { ...identity, role: 'owner', activeOwnerId: null, isSuperadmin, impersonating: false },
      next: isSuperadmin ? 'admin' : 'onboarding'
    };
  }

  if (assignments.length === 1) {
    const a = assignments[0];
    writeSession(event.cookies, {
      ...identity,
      isSuperadmin,
      activeOwnerId: a.ownerId,
      activeRole: a.roleWithinOwner
    });
    return {
      user: {
        ...identity,
        role: a.roleWithinOwner,
        activeOwnerId: a.ownerId,
        isSuperadmin,
        impersonating: false
      },
      next: 'today'
    };
  }

  // Multiple assignments → partial session, Owner picker.
  writeSession(event.cookies, {
    ...identity,
    isSuperadmin,
    activeOwnerId: null,
    activeRole: assignments[0].roleWithinOwner
  });
  return {
    user: {
      ...identity,
      role: assignments[0].roleWithinOwner,
      activeOwnerId: null,
      isSuperadmin,
      impersonating: false
    },
    next: 'picker'
  };
}

/** Re-mint the cookie after an email/phone was linked or removed, keeping
 *  the active Owner, role and impersonation state. */
export function refreshSessionIdentity(event: RequestEvent, user: AuthenticatedUser): void {
  const row = db
    .select({ email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.id, user.id))
    .get();
  if (!row) throw error(401, 'authentication required');
  writeSession(event.cookies, {
    id: user.id,
    email: row.email,
    phone: row.phone,
    isSuperadmin: user.isSuperadmin,
    activeOwnerId: user.activeOwnerId,
    activeRole: user.role,
    impersonating: user.impersonating
  });
}

/** Throws a SvelteKit redirect to the canonical next-step path. Centralizes
 *  the routing so /signin actions don't have to duplicate the mapping. */
export function redirectFromLogin(next: LoginResult['next']): never {
  const path =
    next === 'onboarding'
      ? '/onboarding'
      : next === 'picker'
        ? '/owner-picker'
        : next === 'admin'
          ? '/admin/owners'
          : '/today';
  throw redirect(303, path);
}
