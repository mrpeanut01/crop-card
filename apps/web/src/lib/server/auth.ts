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
  email: string;
  /** Role within the active Owner context. */
  role: SessionRole;
  /** Active Owner id, or null when the session is partial (post-signin,
   *  pre-picker) or when the user has no assignments yet (signup flow). */
  activeOwnerId: string | null;
  isSuperadmin: boolean;
  impersonating: boolean;
}

export function currentUser(event: RequestEvent): AuthenticatedUser | null {
  const session = readSession(event.cookies);
  if (!session) return null;
  return {
    id: session.userId,
    email: session.email,
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
export function isInspectorSession(event: RequestEvent): boolean {
  const u = currentUser(event);
  return !!u && isReadOnly(u.role);
}

/** Superadmin gate for /admin/* endpoints. Distinct from `requireOwner` —
 *  superadmins act across tenants. */
export function requireSuperadmin(event: RequestEvent): AuthenticatedUser {
  const u = requireUser(event);
  if (!u.isSuperadmin) throw error(403, 'superadmin required');
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

export function loginByEmail(
  event: RequestEvent,
  email: string,
  desiredRole: SessionRole = 'helper'
): LoginResult {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw error(400, 'invalid email');
  }
  if (!ALL_SESSION_ROLES.includes(desiredRole)) {
    throw error(400, `invalid role: ${desiredRole}`);
  }

  const existing = db.select().from(users).where(eq(users.email, normalized)).get();
  const userId = existing
    ? existing.id
    : (() => {
        const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        db.insert(users).values({ id, email: normalized }).run();
        return id;
      })();

  const userEmail = existing?.email ?? normalized;
  const isSuperadmin = !!existing?.isSuperadmin;

  const assignments = activeAssignmentsForUser(userId);
  if (assignments.length === 0) {
    writeSession(event.cookies, {
      id: userId,
      email: userEmail,
      isSuperadmin,
      activeOwnerId: null,
      activeRole: 'owner'
    });
    return {
      user: {
        id: userId,
        email: userEmail,
        role: 'owner',
        activeOwnerId: null,
        isSuperadmin,
        impersonating: false
      },
      next: isSuperadmin ? 'admin' : 'onboarding'
    };
  }

  if (assignments.length === 1) {
    const a = assignments[0];
    writeSession(event.cookies, {
      id: userId,
      email: userEmail,
      isSuperadmin,
      activeOwnerId: a.ownerId,
      activeRole: a.roleWithinOwner
    });
    return {
      user: {
        id: userId,
        email: userEmail,
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
    id: userId,
    email: userEmail,
    isSuperadmin,
    activeOwnerId: null,
    activeRole: assignments[0].roleWithinOwner
  });
  return {
    user: {
      id: userId,
      email: userEmail,
      role: assignments[0].roleWithinOwner,
      activeOwnerId: null,
      isSuperadmin,
      impersonating: false
    },
    next: 'picker'
  };
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
