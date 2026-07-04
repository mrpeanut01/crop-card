/**
 * Bearer-vs-cookie auth-gate resolution (#317).
 *
 * Regression test for the Phase-24 bug where a valid owner Bearer token
 * (cck_…) got 401 on every /api/** mutation: the mutation gates funnel
 * through `currentUser()`/`requireUser()`/`requireOwner()`, which read ONLY
 * the cookie session and ignored `event.locals.user` — the Bearer-resolved
 * record hooks.server.ts had already vetted.
 *
 * These tests exercise the auth chokepoint directly against a minimal
 * RequestEvent shape:
 *   - Bearer-resolved locals → currentUser/requireUser/requireOwner succeed
 *     (the mutation path is no longer reads-only).
 *   - A helper Bearer token still 403s on requireOwner (invariant 5).
 *   - The cookie path is unchanged — locals.user is only trusted when
 *     authVia === 'bearer'.
 *   - No auth at all → 401.
 */

import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

import { currentUser, requireUser, requireOwner, type AuthenticatedUser } from './auth';
import { writeSession, type SessionRole } from './session';
import { POST as switchOwnerPost } from '../../routes/api/session/switch-owner/+server';

/** Minimal in-memory Cookies stand-in exercising the real HMAC round-trip. */
function fakeCookies() {
  const store = new Map<string, string>();
  return {
    get: (name: string) => store.get(name),
    getAll: () => [...store.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void store.set(name, value),
    delete: (name: string) => void store.delete(name),
    serialize: () => ''
  } as unknown as RequestEvent['cookies'];
}

interface FakeEventOpts {
  authVia?: 'cookie' | 'bearer';
  localsUser?: AuthenticatedUser;
  cookieSession?: {
    id: string;
    email: string;
    activeOwnerId: string | null;
    activeRole: SessionRole;
    isSuperadmin?: boolean;
  };
}

function fakeEvent(opts: FakeEventOpts): RequestEvent {
  const cookies = fakeCookies();
  if (opts.cookieSession) {
    writeSession(cookies, opts.cookieSession);
  }
  return {
    cookies,
    locals: {
      user: opts.localsUser,
      authVia: opts.authVia
    }
  } as unknown as RequestEvent;
}

function bearerUser(role: SessionRole): AuthenticatedUser {
  return {
    id: 'user_bearer',
    email: 'agent@example.test',
    role,
    activeOwnerId: 'owner_bearer',
    isSuperadmin: false,
    impersonating: false
  };
}

describe('auth gate — Bearer locals resolution (#317)', () => {
  it('currentUser prefers a Bearer-resolved locals.user', () => {
    const event = fakeEvent({ authVia: 'bearer', localsUser: bearerUser('owner') });
    const u = currentUser(event);
    expect(u).not.toBeNull();
    expect(u?.id).toBe('user_bearer');
    expect(u?.activeOwnerId).toBe('owner_bearer');
    expect(u?.role).toBe('owner');
  });

  it('requireUser succeeds for a Bearer owner token (was the 401 bug)', () => {
    const event = fakeEvent({ authVia: 'bearer', localsUser: bearerUser('owner') });
    expect(() => requireUser(event)).not.toThrow();
  });

  it('requireOwner succeeds for a Bearer OWNER token', () => {
    const event = fakeEvent({ authVia: 'bearer', localsUser: bearerUser('owner') });
    const u = requireOwner(event);
    expect(u.role).toBe('owner');
  });

  it('requireOwner still 403s a Bearer HELPER token (invariant 5)', () => {
    const event = fakeEvent({ authVia: 'bearer', localsUser: bearerUser('helper') });
    expect(() => requireOwner(event)).toThrow();
    // requireUser (any authenticated role) still passes for the helper.
    expect(() => requireUser(event)).not.toThrow();
  });

  it('cookie path is unchanged — locals.user is ignored when authVia === "cookie"', () => {
    // Even if a Bearer-shaped user is present in locals, an authVia of
    // 'cookie' must fall through to the signed cookie, never the locals.
    const event = fakeEvent({
      authVia: 'cookie',
      localsUser: bearerUser('owner'),
      cookieSession: {
        id: 'user_cookie',
        email: 'human@example.test',
        activeOwnerId: 'owner_cookie',
        activeRole: 'helper'
      }
    });
    const u = currentUser(event);
    expect(u?.id).toBe('user_cookie');
    expect(u?.activeOwnerId).toBe('owner_cookie');
    expect(u?.role).toBe('helper');
  });

  it('a valid cookie session (no locals) resolves normally', () => {
    const event = fakeEvent({
      cookieSession: {
        id: 'user_cookie',
        email: 'human@example.test',
        activeOwnerId: 'owner_cookie',
        activeRole: 'owner'
      }
    });
    const u = currentUser(event);
    expect(u?.id).toBe('user_cookie');
    expect(u?.role).toBe('owner');
  });

  it('no auth at all → currentUser null, requireUser throws 401', () => {
    const event = fakeEvent({});
    expect(currentUser(event)).toBeNull();
    let status: number | undefined;
    try {
      requireUser(event);
    } catch (e) {
      status = (e as { status?: number }).status;
    }
    expect(status).toBe(401);
  });

  it('authVia "bearer" without a locals.user does not synthesize a user', () => {
    // Defensive: hooks never sets authVia='bearer' without also setting
    // locals.user, but the guard must not fabricate one if it somehow did.
    const event = fakeEvent({ authVia: 'bearer' });
    expect(currentUser(event)).toBeNull();
  });
});

describe('switch-owner Bearer guard (#317) — the 403 must be reachable', () => {
  it('Bearer-authed session is rejected with 403 before any owner switch', async () => {
    // Pre-fix this guard was dead code: currentUser() returned null for
    // Bearer requests, so the handler 401'd before reaching the 403 branch.
    const event = fakeEvent({ authVia: 'bearer', localsUser: bearerUser('owner') });
    let status: number | undefined;
    try {
      await switchOwnerPost(event as unknown as Parameters<typeof switchOwnerPost>[0]);
    } catch (e) {
      status = (e as { status?: number }).status;
    }
    expect(status).toBe(403);
  });

  it('no auth at all → switch-owner 401', async () => {
    const event = fakeEvent({});
    let status: number | undefined;
    try {
      await switchOwnerPost(event as unknown as Parameters<typeof switchOwnerPost>[0]);
    } catch (e) {
      status = (e as { status?: number }).status;
    }
    expect(status).toBe(401);
  });
});
