// @vitest-environment node
/**
 * UC-17 magic-link sign-in: redemption through /auth/verify routes every
 * LoginResult arm exactly like the direct sign-in, mints the existing HMAC
 * session, and AUTH_MODE=magic-link disables direct login server-side
 * without touching the Phase-24 Bearer path.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isHttpError, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { helperAssignments, owners, users } from '$lib/db/schema';
import { issueToken } from '$lib/server/apiTokens';
import { clearOutbox, readOutbox } from '$lib/server/email';
import { requestMagicLink } from '$lib/server/magicLink';
import { readSession, writeSession, type SessionRole } from '$lib/server/session';
import { clearSmsOutbox, readSmsOutbox } from '$lib/server/sms';
import {
  actions as verifyActions,
  load as verifyLoad
} from '../../src/routes/auth/verify/+page.server';
import { actions as landingActions } from '../../src/routes/+page.server';
import { handle, isAnonymous } from '../../src/hooks.server';
import { GET as outboxGet } from '../../src/routes/_dev/outbox/+server';
import { POST as identityPost } from '../../src/routes/api/account/identity/+server';

const ORIGIN = 'http://cropcard.test';

function uniq(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function seedOwner(): string {
  const id = uniq('owner');
  db.insert(owners).values({ id, name: id, slug: id }).run();
  return id;
}

function seedUser(opts: { superadmin?: boolean } = {}): { id: string; email: string } {
  const id = uniq('user');
  const email = `${id}@example.test`;
  db.insert(users)
    .values({ id, email, isSuperadmin: opts.superadmin ?? false })
    .run();
  return { id, email };
}

function assign(ownerId: string, userId: string, role: SessionRole): void {
  db.insert(helperAssignments)
    .values({ ownerId, userId, roleWithinOwner: role, status: 'active' })
    .run();
}

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

function formEvent(path: string, fields: Record<string, string>): RequestEvent {
  const url = new URL(path, ORIGIN);
  return {
    url,
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString()
    }),
    cookies: fakeCookies(),
    locals: {},
    params: {},
    getClientAddress: () => `10.0.0.${Math.floor(Math.random() * 250)}`
  } as unknown as RequestEvent;
}

async function mintLink(email: string, invite?: string): Promise<URL> {
  const r = await requestMagicLink({
    email,
    ip: uniq('ip'),
    origin: ORIGIN,
    inviteToken: invite
  });
  expect(r.outcome).toBe('sent');
  const mail = readOutbox(email).at(-1);
  if (mail?.email.kind !== 'magic-link') throw new Error('no magic-link mail');
  return new URL(mail.email.loginUrl);
}

async function redeem(link: URL): Promise<{ location: string; event: RequestEvent }> {
  const fields: Record<string, string> = { token: link.searchParams.get('token')! };
  const invite = link.searchParams.get('invite');
  if (invite) fields.invite = invite;
  const event = formEvent('/auth/verify?/confirm', fields);
  try {
    await verifyActions.confirm!(event as never);
  } catch (e) {
    if (isRedirect(e)) return { location: e.location, event };
    throw e;
  }
  throw new Error('confirm did not redirect');
}

const savedEnv = { ...process.env };

beforeEach(() => {
  process.env.EMAIL_TRANSPORT = 'memory';
  process.env.SMS_TRANSPORT = 'memory';
  process.env.AUTH_MODE = 'magic-link';
  clearOutbox();
  clearSmsOutbox();
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe('/auth/verify → LoginResult routing', () => {
  it('owner with one assignment → /today with an owner session', async () => {
    const ownerId = seedOwner();
    const u = seedUser();
    assign(ownerId, u.id, 'owner');
    const { location, event } = await redeem(await mintLink(u.email));
    expect(location).toBe('/today');
    const s = readSession(event.cookies);
    expect(s).toMatchObject({
      userId: u.id,
      email: u.email,
      activeOwnerId: ownerId,
      activeRole: 'owner',
      isSuperadmin: false
    });
  });

  it('helper with one assignment → /today with a helper session', async () => {
    const ownerId = seedOwner();
    const u = seedUser();
    assign(ownerId, u.id, 'helper');
    const { location, event } = await redeem(await mintLink(u.email));
    expect(location).toBe('/today');
    expect(readSession(event.cookies)).toMatchObject({
      activeOwnerId: ownerId,
      activeRole: 'helper'
    });
  });

  it('multi-owner user → /owner-picker with a partial session', async () => {
    const a = seedOwner();
    const b = seedOwner();
    const u = seedUser();
    assign(a, u.id, 'owner');
    assign(b, u.id, 'helper');
    const { location, event } = await redeem(await mintLink(u.email));
    expect(location).toBe('/owner-picker');
    expect(readSession(event.cookies)?.activeOwnerId).toBeNull();
  });

  it('superadmin without assignments → /admin/owners', async () => {
    const u = seedUser({ superadmin: true });
    const { location, event } = await redeem(await mintLink(u.email));
    expect(location).toBe('/admin/owners');
    expect(readSession(event.cookies)).toMatchObject({ isSuperadmin: true, activeOwnerId: null });
  });

  it('brand-new email → users row created on redemption, /onboarding', async () => {
    const email = `${uniq('new')}@example.test`;
    const link = await mintLink(email);
    expect(db.select().from(users).where(eq(users.email, email)).get()).toBeUndefined();
    const { location, event } = await redeem(link);
    expect(location).toBe('/onboarding');
    const row = db.select().from(users).where(eq(users.email, email)).get();
    expect(row).toBeDefined();
    expect(readSession(event.cookies)?.userId).toBe(row!.id);
  });

  it('an invite token threads through to /invite/<token>', async () => {
    const u = seedUser();
    const invite = 'inv0123456789ABCDEFxyz_-';
    const { location } = await redeem(await mintLink(u.email, invite));
    expect(location).toBe(`/invite/${invite}`);
  });

  it('a redeemed link cannot be replayed', async () => {
    const u = seedUser();
    const link = await mintLink(u.email);
    await redeem(link);
    const replay = formEvent('/auth/verify?/confirm', { token: link.searchParams.get('token')! });
    const res = await verifyActions.confirm!(replay as never);
    expect(res).toMatchObject({ status: 400, data: { reason: 'used' } });
    expect(readSession(replay.cookies)).toBeNull();
  });

  it('GET load previews without consuming, and reports bad tokens', async () => {
    const u = seedUser();
    const link = await mintLink(u.email);
    const loadEvent = { url: link } as never;
    expect(await verifyLoad(loadEvent)).toMatchObject({ status: 'ready', email: u.email });
    expect(await verifyLoad(loadEvent)).toMatchObject({ status: 'ready' });
    const bad = { url: new URL('/auth/verify?token=nope', ORIGIN) } as never;
    expect(await verifyLoad(bad)).toMatchObject({ status: 'invalid', reason: 'invalid' });
  });
});

describe('AUTH_MODE gates the direct login server-side', () => {
  async function runLanding(action: 'signin' | 'demo', fields: Record<string, string>) {
    const event = formEvent(`/?/${action}`, fields);
    try {
      return { result: await landingActions[action]!(event as never), event };
    } catch (e) {
      return { thrown: e, event };
    }
  }

  it('magic-link mode: email sign-in and demo both 403 and mint no session', async () => {
    for (const [action, fields] of [
      ['signin', { email: 'owner@cropcard.local' }],
      ['demo', { role: 'owner' }]
    ] as const) {
      const { thrown, event } = await runLanding(action, fields);
      expect(isHttpError(thrown) && thrown.status).toBe(403);
      expect(readSession(event.cookies)).toBeNull();
    }
  });

  it('direct mode: email sign-in still mints the session', async () => {
    process.env.AUTH_MODE = 'direct';
    const ownerId = seedOwner();
    const u = seedUser();
    assign(ownerId, u.id, 'owner');
    const { thrown, event } = await runLanding('signin', { email: u.email });
    expect(isRedirect(thrown) && thrown.location).toBe('/today');
    expect(readSession(event.cookies)).toMatchObject({ userId: u.id, activeOwnerId: ownerId });
  });

  it('magic mode landing action sends a link with the generic message', async () => {
    const email = `${uniq('landing')}@example.test`;
    const event = formEvent('/?/magic', { email });
    const res = await landingActions.magic!(event as never);
    expect(res).toMatchObject({ sent: true });
    expect(readOutbox(email)).toHaveLength(1);
    expect(readSession(event.cookies)).toBeNull();
  });
});

describe('one-field sign-in: email or phone, then a 6-digit code', () => {
  async function runCode(fields: Record<string, string>) {
    const event = formEvent('/?/code', fields);
    try {
      return { result: await landingActions.code!(event as never), event };
    } catch (e) {
      if (isRedirect(e)) return { location: e.location, event };
      throw e;
    }
  }

  function smsCode(phone: string): string {
    return /^(\d{6}) /.exec(readSmsOutbox(phone).at(-1)!.body)![1];
  }

  it('a new phone number signs up phone-only and lands on onboarding', async () => {
    const phone = `+1571555${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`;
    const start = formEvent('/?/magic', { identifier: phone.slice(2) });
    const res = await landingActions.magic!(start as never);
    expect(res).toMatchObject({ sent: true, channel: 'sms', identifier: phone });

    const { location, event } = await runCode({ identifier: phone, code: smsCode(phone) });
    expect(location).toBe('/onboarding');
    expect(readSession(event.cookies)).toMatchObject({ email: null, phone });
    expect(db.select().from(users).where(eq(users.phone, phone)).get()?.email).toBeNull();
  });

  it('an existing email user can sign in with the code from the magic-link email', async () => {
    const ownerId = seedOwner();
    const u = seedUser();
    assign(ownerId, u.id, 'owner');
    await landingActions.magic!(formEvent('/?/magic', { identifier: u.email }) as never);
    const mail = readOutbox(u.email).at(-1)!.email as { code: string };
    const { location, event } = await runCode({ identifier: u.email, code: mail.code });
    expect(location).toBe('/today');
    expect(readSession(event.cookies)).toMatchObject({ userId: u.id, activeOwnerId: ownerId });
  });

  it('a wrong code keeps the code form up with an error and mints no session', async () => {
    const u = seedUser();
    await landingActions.magic!(formEvent('/?/magic', { identifier: u.email }) as never);
    const { code } = readOutbox(u.email).at(-1)!.email as { code: string };
    const { result, event } = await runCode({
      identifier: u.email,
      code: code === '000000' ? '111111' : '000000'
    });
    expect(result).toMatchObject({
      status: 400,
      data: { sent: true, codeError: expect.any(String) }
    });
    expect(readSession(event.cookies)).toBeNull();
  });

  it('a code threads the invite token through to /invite/<token>', async () => {
    const u = seedUser();
    const invite = 'x'.repeat(24);
    await landingActions.magic!(formEvent('/?/magic', { identifier: u.email, invite }) as never);
    const { code } = readOutbox(u.email).at(-1)!.email as { code: string };
    const { location } = await runCode({ identifier: u.email, code, invite });
    expect(location).toBe(`/invite/${invite}`);
  });
});

describe('linking identities requires the interactive session', () => {
  it('refuses a Bearer-authenticated request', async () => {
    const u = seedUser();
    const event = {
      request: new Request(`${ORIGIN}/api/account/identity`, {
        method: 'POST',
        body: JSON.stringify({ identifier: '5715550199' })
      }),
      cookies: fakeCookies(),
      locals: {
        authVia: 'bearer',
        user: {
          id: u.id,
          email: u.email,
          phone: null,
          role: 'owner',
          activeOwnerId: null,
          isSuperadmin: false,
          impersonating: false
        }
      }
    } as unknown as RequestEvent;
    await expect(identityPost(event as never)).rejects.toMatchObject({ status: 403 });
    expect(readSmsOutbox('+15715550199')).toHaveLength(0);
  });

  it('sends a code for a cookie session', async () => {
    const u = seedUser();
    const cookies = fakeCookies();
    writeSession(cookies, {
      id: u.id,
      email: u.email,
      phone: null,
      activeOwnerId: null,
      activeRole: 'owner'
    });
    const event = {
      request: new Request(`${ORIGIN}/api/account/identity`, {
        method: 'POST',
        body: JSON.stringify({ identifier: '(571) 555-0198' })
      }),
      cookies,
      locals: {}
    } as unknown as RequestEvent;
    const res = await identityPost(event as never);
    expect(res.status).toBe(200);
    expect(readSmsOutbox('+15715550198')).toHaveLength(1);
  });
});

describe('Bearer path is unaffected by AUTH_MODE', () => {
  function bearerEvent(token: string): RequestEvent {
    const url = new URL('/api/blocks', ORIGIN);
    return {
      url,
      request: new Request(url, { headers: { authorization: `Bearer ${token}` } }),
      cookies: fakeCookies(),
      locals: {},
      params: {},
      getClientAddress: () => '10.9.9.9'
    } as unknown as RequestEvent;
  }

  it('a valid cck_ token still resolves the owner-scoped user in magic-link mode', async () => {
    const ownerId = seedOwner();
    const u = seedUser();
    assign(ownerId, u.id, 'owner');
    const issued = issueToken({ ownerId, userId: u.id, label: 'agent' });
    const event = bearerEvent(issued.token);
    let seen: RequestEvent | null = null;
    const res = await handle({
      event,
      resolve: async (ev) => {
        seen = ev;
        return new Response('ok');
      }
    });
    expect(res.status).toBe(200);
    expect(seen).not.toBeNull();
    expect(event.locals.authVia).toBe('bearer');
    expect(event.locals.user).toMatchObject({ id: u.id, activeOwnerId: ownerId, role: 'owner' });
  });

  it('an unknown Bearer token still 401s', async () => {
    const res = await handle({
      event: bearerEvent('cck_not-a-real-token'),
      resolve: async () => new Response('should not reach')
    });
    expect(res.status).toBe(401);
  });
});

describe('route exposure', () => {
  it('only the magic-link request + verify routes are anonymous', () => {
    expect(isAnonymous('/api/auth/magic-link')).toBe(true);
    expect(isAnonymous('/auth/verify')).toBe(true);
    expect(isAnonymous('/api/auth/token')).toBe(false);
    expect(isAnonymous('/auth/verify/extra')).toBe(false);
  });

  it('/_dev/outbox 404s unless the memory transport is enabled for tests', async () => {
    const call = () => outboxGet({ url: new URL('/_dev/outbox', ORIGIN) } as never);
    process.env.EMAIL_TRANSPORT = 'stdout';
    await expect(Promise.resolve().then(call)).rejects.toMatchObject({ status: 404 });
    process.env.EMAIL_TRANSPORT = 'memory';
    process.env.NODE_ENV = 'production';
    delete process.env.E2E_OUTBOX;
    await expect(Promise.resolve().then(call)).rejects.toMatchObject({ status: 404 });
    process.env.E2E_OUTBOX = '1';
    const res = await call();
    expect(res.status).toBe(200);
  });
});
