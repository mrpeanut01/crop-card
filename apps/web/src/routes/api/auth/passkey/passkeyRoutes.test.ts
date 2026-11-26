// @vitest-environment node
// Phase 38 passkey routes: who may call them and what they answer.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import { DEMO_EMAIL_DOMAIN } from '$lib/demo/identity';
import type { AuthenticatedUser } from '$lib/server/auth';
import { loginByIdentity } from '$lib/server/auth';
import { OFFER_COOKIE } from '$lib/server/passkeyOffer';
import { SoftAuthenticator } from '$lib/server/__fixtures__/softAuthenticator';
import { listPasskeys } from '$lib/server/passkeys';
import { demoBlocksWrite } from '$lib/server/demo/guard';
import { allowsPartialSession, isAnonymous, isAnyRoleApiWrite } from '../../../../hooks.server';
import { POST as registerOptions } from './register/options/+server';
import { POST as registerVerify } from './register/verify/+server';
import { POST as loginOptionsRoute } from './login/options/+server';
import { POST as loginVerify } from './login/verify/+server';
import { DELETE as offerDelete } from './offer/+server';
import {
  DELETE as passkeyDelete,
  PATCH as passkeyPatch
} from '../../account/passkeys/[id]/+server';
import { GET as passkeyList } from '../../account/passkeys/+server';

const ORIGIN = 'http://localhost:5173';

function jar() {
  const store = new Map<string, string>();
  const cookies = {
    get: (name: string) => store.get(name),
    getAll: () => [...store.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void store.set(name, value),
    delete: (name: string) => void store.delete(name),
    serialize: () => ''
  } as unknown as RequestEvent['cookies'];
  return { store, cookies };
}

function seedUser(email?: string): AuthenticatedUser {
  const id = `pkr-${randomUUID().slice(0, 8)}`;
  const mail = email ?? `${id}@example.com`;
  db.insert(users).values({ id, email: mail }).run();
  return {
    id,
    email: mail,
    phone: null,
    role: 'owner',
    activeOwnerId: null,
    isSuperadmin: false,
    impersonating: false,
    sessionIssuedAt: Date.now()
  };
}

function ev(
  path: string,
  opts: {
    user?: AuthenticatedUser;
    authVia?: 'cookie' | 'bearer';
    body?: unknown;
    method?: string;
    params?: Record<string, string>;
    cookies?: RequestEvent['cookies'];
  } = {}
): RequestEvent {
  return {
    cookies: opts.cookies ?? jar().cookies,
    url: new URL(`${ORIGIN}${path}`),
    params: opts.params ?? {},
    locals: { user: opts.user, authVia: opts.user ? (opts.authVia ?? 'cookie') : undefined },
    request: new Request(`${ORIGIN}${path}`, {
      method: opts.method ?? 'POST',
      headers: { 'content-type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
    }),
    getClientAddress: () => '9.9.9.9'
  } as unknown as RequestEvent;
}

async function status(call: () => Promise<Response> | Response): Promise<number> {
  try {
    return (await call()).status;
  } catch (e) {
    return (e as { status?: number }).status ?? 500;
  }
}

describe('request gates', () => {
  it('lets anyone reach the sign-in endpoints and nothing else', () => {
    expect(isAnonymous('/api/auth/passkey/login/options')).toBe(true);
    expect(isAnonymous('/api/auth/passkey/login/verify')).toBe(true);
    expect(isAnonymous('/api/auth/passkey/register/options')).toBe(false);
    expect(isAnonymous('/api/account/passkeys')).toBe(false);
  });

  it('lets a partial session add a passkey (onboarding)', () => {
    expect(allowsPartialSession('/api/auth/passkey/register/options', false)).toBe(true);
    expect(allowsPartialSession('/api/auth/passkey/register/verify', false)).toBe(true);
    expect(allowsPartialSession('/api/auth/passkey/offer', false)).toBe(true);
  });

  it('lets an inspector manage their own passkeys', () => {
    expect(isAnyRoleApiWrite('/api/auth/passkey/register/verify')).toBe(true);
    expect(isAnyRoleApiWrite('/api/account/passkeys/pk_1')).toBe(true);
    expect(isAnyRoleApiWrite('/api/stock')).toBe(false);
  });

  it('blocks demo visitors from adding or changing passkeys (P38-8)', () => {
    expect(demoBlocksWrite('POST', '/api/auth/passkey/register/options')).toBe(true);
    expect(demoBlocksWrite('PATCH', '/api/account/passkeys/pk_1')).toBe(true);
    expect(demoBlocksWrite('POST', '/api/auth/passkey/login/options')).toBe(false);
  });
});

describe('adding a passkey', () => {
  it('works for a fresh cookie session, end to end through the routes', async () => {
    const user = seedUser();
    const browser = jar();
    const optsRes = await registerOptions(
      ev('/api/auth/passkey/register/options', { user, cookies: browser.cookies })
    );
    expect(optsRes.status).toBe(200);
    const { options } = await optsRes.json();
    const auth = new SoftAuthenticator({
      rpID: 'localhost',
      origin: ORIGIN,
      userHandle: options.user.id
    });
    const res = await registerVerify(
      ev('/api/auth/passkey/register/verify', {
        user,
        cookies: browser.cookies,
        body: auth.register(options.challenge)
      })
    );
    expect(res.status).toBe(201);
    expect(listPasskeys(user.id)).toHaveLength(1);
  });

  it('refuses a Bearer token and an impersonating superadmin', async () => {
    const user = seedUser();
    expect(
      await status(() =>
        registerOptions(ev('/api/auth/passkey/register/options', { user, authVia: 'bearer' }))
      )
    ).toBe(403);
    expect(
      await status(() =>
        registerOptions(
          ev('/api/auth/passkey/register/options', { user: { ...user, impersonating: true } })
        )
      )
    ).toBe(403);
  });

  it('asks for a fresh sign-in after ten minutes (P38-5)', async () => {
    const user = { ...seedUser(), sessionIssuedAt: Date.now() - 11 * 60_000 };
    const res = await registerOptions(ev('/api/auth/passkey/register/options', { user }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('REAUTH_REQUIRED');
  });

  it('refuses a demo visitor', async () => {
    const user = seedUser(`v-${randomUUID().slice(0, 6)}@${DEMO_EMAIL_DOMAIN}`);
    const res = await registerOptions(ev('/api/auth/passkey/register/options', { user }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('DEMO_DISABLED');
  });

  it('answers 401 without a session', async () => {
    expect(await status(() => registerOptions(ev('/api/auth/passkey/register/options')))).toBe(401);
  });
});

describe('signing in', () => {
  it('returns the landing page and one generic error for any failure', async () => {
    const user = seedUser();
    const browser = jar();
    const { options } = await (
      await registerOptions(
        ev('/api/auth/passkey/register/options', { user, cookies: browser.cookies })
      )
    ).json();
    const auth = new SoftAuthenticator({
      rpID: 'localhost',
      origin: ORIGIN,
      userHandle: options.user.id
    });
    await registerVerify(
      ev('/api/auth/passkey/register/verify', {
        user,
        cookies: browser.cookies,
        body: auth.register(options.challenge)
      })
    );

    const visitor = jar();
    const login = await (
      await loginOptionsRoute(ev('/api/auth/passkey/login/options', { cookies: visitor.cookies }))
    ).json();
    const ok = await loginVerify(
      ev('/api/auth/passkey/login/verify', {
        cookies: visitor.cookies,
        body: auth.signIn(login.options.challenge)
      })
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ next: '/onboarding', crossDevice: false });

    const stranger = new SoftAuthenticator({ rpID: 'localhost', origin: ORIGIN });
    const again = await (
      await loginOptionsRoute(ev('/api/auth/passkey/login/options', { cookies: visitor.cookies }))
    ).json();
    const bad = await loginVerify(
      ev('/api/auth/passkey/login/verify', {
        cookies: visitor.cookies,
        body: stranger.signIn(again.options.challenge)
      })
    );
    const garbage = await loginVerify(
      ev('/api/auth/passkey/login/verify', { cookies: visitor.cookies, body: { nope: 1 } })
    );
    expect(bad.status).toBe(401);
    expect(garbage.status).toBe(400);
    expect((await bad.json()).error).toBe((await garbage.json()).error);
  });
});

describe('the add-a-passkey offer', () => {
  it('is set by an email or SMS sign-in and cleared by "Not now"', async () => {
    const user = seedUser();
    const browser = jar();
    loginByIdentity({ cookies: browser.cookies, locals: {} } as unknown as RequestEvent, {
      email: user.email!
    });
    expect(browser.store.get(OFFER_COOKIE)).toBe('1');
    await offerDelete(
      ev('/api/auth/passkey/offer', { user, cookies: browser.cookies, method: 'DELETE' })
    );
    expect(browser.store.has(OFFER_COOKIE)).toBe(false);
  });
});

describe('managing passkeys through the API', () => {
  it("lists only your own and answers 404 for someone else's", async () => {
    const alice = seedUser();
    const bob = seedUser();
    const browser = jar();
    const { options } = await (
      await registerOptions(
        ev('/api/auth/passkey/register/options', { user: alice, cookies: browser.cookies })
      )
    ).json();
    const auth = new SoftAuthenticator({ rpID: 'localhost', origin: ORIGIN });
    await registerVerify(
      ev('/api/auth/passkey/register/verify', {
        user: alice,
        cookies: browser.cookies,
        body: auth.register(options.challenge)
      })
    );
    const [pk] = listPasskeys(alice.id);

    const bobList = await (
      await passkeyList(ev('/api/account/passkeys', { user: bob, method: 'GET' }))
    ).json();
    expect(bobList.passkeys).toEqual([]);

    const params = { id: pk.id };
    const p = `/api/account/passkeys/${pk.id}`;
    expect(
      (await passkeyPatch(ev(p, { user: bob, method: 'PATCH', params, body: { name: 'x' } })))
        .status
    ).toBe(404);
    expect((await passkeyDelete(ev(p, { user: bob, method: 'DELETE', params }))).status).toBe(404);
    expect(
      (
        await passkeyPatch(
          ev(p, { user: alice, method: 'PATCH', params, body: { name: '  Barn phone ' } })
        )
      ).status
    ).toBe(200);
    expect(listPasskeys(alice.id)[0].name).toBe('Barn phone');
    expect((await passkeyDelete(ev(p, { user: alice, method: 'DELETE', params }))).status).toBe(
      200
    );
    expect(listPasskeys(alice.id)).toEqual([]);
  });

  it('refuses a Bearer token', async () => {
    const user = seedUser();
    expect(
      await status(() =>
        passkeyList(ev('/api/account/passkeys', { user, authVia: 'bearer', method: 'GET' }))
      )
    ).toBe(403);
  });
});
