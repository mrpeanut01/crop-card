/**
 * Server-side authentication + authorization helpers.
 *
 * `requireUser` / `requireOwner` throw a SvelteKit error response that the
 * endpoint can re-throw to short-circuit. Use these on every endpoint that
 * mutates state (NFR-10 audit trail; FR-09 role-gated overrides).
 */

import { error, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import { readSession, writeSession, type SessionRole } from './session';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: SessionRole;
}

export function currentUser(event: RequestEvent): AuthenticatedUser | null {
  const session = readSession(event.cookies);
  if (!session) return null;
  return { id: session.userId, email: session.email, role: session.role };
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

/**
 * Look up or create a user by email. New emails default to helper role; the
 * `system` user is hard-coded as owner. Real magic-link flows would replace
 * this with a verified email confirmation step.
 */
export function loginByEmail(
  event: RequestEvent,
  email: string,
  desiredRole: SessionRole = 'helper'
): AuthenticatedUser {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw error(400, 'invalid email');
  }

  const existing = db.select().from(users).where(eq(users.email, normalized)).get();
  let user: AuthenticatedUser;
  if (existing) {
    user = {
      id: existing.id,
      email: existing.email,
      role: existing.role as SessionRole
    };
  } else {
    const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const inserted = db
      .insert(users)
      .values({ id, email: normalized, role: desiredRole })
      .returning()
      .get();
    user = {
      id: inserted.id,
      email: inserted.email,
      role: inserted.role as SessionRole
    };
  }

  writeSession(event.cookies, user);
  return user;
}
