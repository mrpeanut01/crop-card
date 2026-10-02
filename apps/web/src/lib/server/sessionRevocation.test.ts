// "Sign out everywhere": cookies issued before users.sessions_valid_after
// are refused at the request boundary.
import { createHmac, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import { revalidateCookieUser } from '../../hooks.server';
import { actions as accountActions } from '../../routes/settings/account/+page.server';
import {
  currentUser,
  refreshSessionIdentity,
  signOutEverywhere,
  type AuthenticatedUser
} from './auth';
import { authSecret, readSession, writeSession } from './session';

const COOKIE = 'cropcard.session';

function fakeCookies() {
  const store = new Map<string, string>();
  return {
    store,
    cookies: {
      get: (name: string) => store.get(name),
      getAll: () => [...store.entries()].map(([name, value]) => ({ name, value })),
      set: (name: string, value: string) => void store.set(name, value),
      delete: (name: string) => void store.delete(name),
      serialize: () => ''
    } as unknown as RequestEvent['cookies']
  };
}

function seedUser(): string {
  const id = `sess-rev-${randomUUID().slice(0, 8)}`;
  db.insert(users)
    .values({ id, email: `${id}@test` })
    .run();
  return id;
}

const validAfter = (id: string) =>
  db.select({ at: users.sessionsValidAfter }).from(users).where(eq(users.id, id)).get()?.at ?? null;

function setValidAfter(id: string, at: number | null) {
  db.update(users)
    .set({ sessionsValidAfter: at === null ? null : new Date(at) })
    .where(eq(users.id, id))
    .run();
}

function cookieUser(id: string, iat?: number): AuthenticatedUser {
  return {
    id,
    email: `${id}@test`,
    phone: null,
    role: 'owner',
    activeOwnerId: null,
    isSuperadmin: false,
    impersonating: false,
    sessionIssuedAt: iat
  };
}

/** A browser holding a signed cookie for `id`, minted at `iat`. */
function signedInEvent(
  id: string,
  opts: { iat?: number; authVia?: 'cookie' | 'bearer'; impersonating?: boolean } = {}
) {
  const jar = fakeCookies();
  writeSession(jar.cookies, {
    id,
    email: `${id}@test`,
    phone: null,
    activeOwnerId: null,
    activeRole: 'owner',
    impersonating: opts.impersonating,
    iat: opts.iat
  });
  const event = { cookies: jar.cookies, locals: {} } as unknown as RequestEvent;
  const user = currentUser(event)!;
  event.locals.user = user;
  event.locals.authVia = opts.authVia ?? 'cookie';
  return { event, jar, user };
}

/** A cookie in the pre-iat format, signed with the real key. */
function legacyCookie(id: string): string {
  const body = Buffer.from(
    JSON.stringify({
      userId: id,
      email: `${id}@test`,
      phone: null,
      isSuperadmin: false,
      activeOwnerId: null,
      activeRole: 'owner',
      exp: Date.now() + 60_000
    })
  ).toString('base64url');
  const sig = createHmac('sha256', authSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

describe('session iat', () => {
  it('stamps a fresh sign-in with now and keeps a passed iat on re-mint', () => {
    const before = Date.now();
    const jar = fakeCookies();
    writeSession(jar.cookies, {
      id: 'u1',
      email: 'u1@test',
      phone: null,
      activeOwnerId: null,
      activeRole: 'owner'
    });
    const iat = readSession(jar.cookies)!.iat;
    expect(iat).toBeGreaterThanOrEqual(before);
    expect(iat).toBeLessThanOrEqual(Date.now());

    writeSession(jar.cookies, {
      id: 'u1',
      email: 'u1@test',
      phone: null,
      activeOwnerId: 'owner_x',
      activeRole: 'helper',
      iat: 1234
    });
    expect(readSession(jar.cookies)!.iat).toBe(1234);
  });

  it('reads a cookie minted before iat existed as issued at 0', () => {
    const jar = fakeCookies();
    jar.store.set(COOKIE, legacyCookie('u2'));
    expect(readSession(jar.cookies)?.iat).toBe(0);
  });

  it('carries iat through currentUser and keeps it when the identity is refreshed', () => {
    const id = seedUser();
    const { event, jar, user } = signedInEvent(id, { iat: 5000 });
    expect(user.sessionIssuedAt).toBe(5000);
    refreshSessionIdentity(event, user);
    expect(readSession(jar.cookies)!.iat).toBe(5000);
  });
});

describe('revalidateCookieUser and sessions_valid_after', () => {
  it('accepts any cookie while the user never signed out everywhere', () => {
    const id = seedUser();
    expect(revalidateCookieUser(cookieUser(id, Date.now()))).not.toBeNull();
    expect(revalidateCookieUser(cookieUser(id, 0))).not.toBeNull();
    expect(revalidateCookieUser(cookieUser(id))).not.toBeNull();
  });

  it('refuses cookies issued before the cutoff and accepts later ones', () => {
    const id = seedUser();
    const cutoff = Date.now();
    setValidAfter(id, cutoff);
    expect(revalidateCookieUser(cookieUser(id, cutoff - 1))).toBeNull();
    expect(revalidateCookieUser(cookieUser(id, cutoff))).not.toBeNull();
    expect(revalidateCookieUser(cookieUser(id, cutoff + 60_000))).not.toBeNull();
  });

  it('refuses a legacy cookie with no iat once a cutoff is set', () => {
    const id = seedUser();
    setValidAfter(id, Date.now());
    expect(revalidateCookieUser(cookieUser(id, 0))).toBeNull();
    expect(revalidateCookieUser(cookieUser(id))).toBeNull();
  });

  it('refuses an impersonating cookie issued before the cutoff', () => {
    const id = seedUser();
    db.update(users).set({ isSuperadmin: true }).where(eq(users.id, id)).run();
    setValidAfter(id, Date.now());
    const u = { ...cookieUser(id, 1), activeOwnerId: 'owner_x', impersonating: true };
    expect(revalidateCookieUser(u)).toBeNull();
  });

  it("leaves other users' cookies alone", () => {
    const a = seedUser();
    const b = seedUser();
    const iat = Date.now() - 1000;
    setValidAfter(a, Date.now());
    expect(revalidateCookieUser(cookieUser(a, iat))).toBeNull();
    expect(revalidateCookieUser(cookieUser(b, iat))).not.toBeNull();
  });
});

describe('signOutEverywhere', () => {
  it('stamps the cutoff, clears this cookie and locks out the other browsers', () => {
    const id = seedUser();
    const other = signedInEvent(id, { iat: Date.now() - 60_000 });
    const here = signedInEvent(id);
    const now = new Date(Date.now() + 1);

    signOutEverywhere(here.event, now);

    expect(validAfter(id)?.getTime()).toBe(now.getTime());
    expect(here.jar.store.has(COOKIE)).toBe(false);
    expect(revalidateCookieUser(other.user)).toBeNull();
    expect(revalidateCookieUser(here.user)).toBeNull();

    const fresh = fakeCookies();
    writeSession(fresh.cookies, {
      id,
      email: `${id}@test`,
      phone: null,
      activeOwnerId: null,
      activeRole: 'owner',
      iat: now.getTime() + 1
    });
    const back = currentUser({ cookies: fresh.cookies, locals: {} } as unknown as RequestEvent)!;
    expect(revalidateCookieUser(back)).not.toBeNull();
  });

  it('refuses Bearer tokens and impersonation without writing anything', () => {
    for (const opts of [{ authVia: 'bearer' as const }, { impersonating: true }]) {
      const id = seedUser();
      const { event, jar } = signedInEvent(id, opts);
      expect(() => signOutEverywhere(event)).toThrow(expect.objectContaining({ status: 403 }));
      expect(validAfter(id)).toBeNull();
      expect(jar.store.has(COOKIE)).toBe(true);
    }
  });

  it('the account action redirects to the landing page', () => {
    const id = seedUser();
    const { event, jar } = signedInEvent(id);
    let thrown: unknown;
    try {
      (accountActions.signOutEverywhere as (e: RequestEvent) => unknown)(event);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ status: 303, location: '/' });
    expect(jar.store.has(COOKIE)).toBe(false);
    expect(validAfter(id)).not.toBeNull();
  });
});
