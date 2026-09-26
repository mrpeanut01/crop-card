// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { runWithTenant, runWithTenantAsync } from '$lib/db/tenant';
import { addAssignment } from '$lib/db/users';
import {
  getEmailPrefsForUser,
  listConsentHistoryForUser,
  optIn,
  optOut
} from '$lib/db/emailAlertConsents';
import { isEmailSuppressed, recordSuppression } from '$lib/db/contactSuppressions';
import { clearOutbox, readOutbox } from '$lib/server/email';
import { testEmailLimiter } from '$lib/server/testEmailLimit';
import { createSendLimiter } from '$lib/server/sendLimiter';
import { signPingramPayload } from '$lib/server/pingramWebhook';
import { signUnsubscribeToken, type UnsubscribeScope } from '$lib/server/emailUnsubscribe';
import type { AuthenticatedUser } from '$lib/server/auth';
import { POST as prefsPost } from './prefs/+server';
import { POST as testPost } from './test/+server';
import { GET as oneClickGet, POST as oneClickPost } from './unsubscribe/+server';
import { POST as webhookPost } from './pingram-webhook/+server';
import { actions, load } from '../../unsubscribe/[token]/+page.server';

type Role = 'owner' | 'helper' | 'inspector';

function seed(role: Role = 'owner', email: string | null = 'x') {
  const ownerId = `route-owner-${randomUUID()}`;
  const userId = `route-user-${randomUUID()}`;
  db.insert(owners).values({ id: ownerId, name: 'Safe Haven Farm', slug: ownerId }).run();
  const address = email === null ? null : `${userId}@route.test`;
  db.insert(users)
    .values({ id: userId, email: address, phone: address ? null : `+1571${Date.now() % 1e7}` })
    .run();
  addAssignment({ ownerId, userId, roleWithinOwner: role });
  const user: AuthenticatedUser = {
    id: userId,
    email: address,
    phone: null,
    role,
    activeOwnerId: ownerId,
    isSuperadmin: false,
    impersonating: false
  };
  return { ownerId, userId, user };
}

function apiEvent(
  user: AuthenticatedUser | null,
  body?: unknown,
  extra: { authVia?: 'cookie' | 'bearer' } = {}
) {
  return {
    cookies: { get: () => undefined },
    locals: { user, authVia: extra.authVia ?? 'cookie' },
    params: {},
    url: new URL('http://localhost/api/email/prefs'),
    getClientAddress: () => '198.51.100.23',
    request: new Request('http://localhost/api/email/prefs', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
      headers: { 'content-type': 'application/json' }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function call(
  fn: () => unknown,
  ownerId?: string | null
): Promise<{ status: number; body: unknown }> {
  try {
    const res = (await (ownerId
      ? runWithTenantAsync(ownerId, async () => fn())
      : fn())) as Response;
    return { status: res.status, body: await res.json() };
  } catch (e) {
    const h = e as { status?: number; body?: unknown };
    if (typeof h?.status === 'number') return { status: h.status, body: h.body };
    throw e;
  }
}

beforeEach(() => {
  vi.stubEnv('EMAIL_TRANSPORT', 'memory');
  clearOutbox();
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/email/prefs', () => {
  it('records an explicit opt-in with source and IP, and an opt-out keeps the history', async () => {
    const { user, ownerId, userId } = seed();
    const on = await call(
      () => prefsPost(apiEvent(user, { category: 'decon-due', enabled: true })),
      ownerId
    );
    expect(on.status).toBe(200);
    expect((on.body as { prefs: Record<string, boolean> }).prefs['decon-due']).toBe(true);
    const [row] = runWithTenant(ownerId, () => listConsentHistoryForUser(userId));
    expect(row).toMatchObject({
      category: 'decon-due',
      status: 'opted-in',
      optedInSource: 'settings',
      optedInIp: '198.51.100.23'
    });
    await call(() => prefsPost(apiEvent(user, { category: 'decon-due', enabled: false })), ownerId);
    const [after] = runWithTenant(ownerId, () => listConsentHistoryForUser(userId));
    expect(after.status).toBe('opted-out');
    expect(after.optedInAt).toBe(row.optedInAt);
  });

  it('refuses API tokens, impersonation, inspectors, bad bodies and users without email', async () => {
    const { user } = seed();
    const body = { category: 'decon-due', enabled: true };
    expect((await call(() => prefsPost(apiEvent(user, body, { authVia: 'bearer' })))).status).toBe(
      403
    );
    expect(
      (await call(() => prefsPost(apiEvent({ ...user, impersonating: true }, body)))).status
    ).toBe(403);
    expect((await call(() => prefsPost(apiEvent(seed('inspector').user, body)))).status).toBe(403);
    expect((await call(() => prefsPost(apiEvent(null, body)))).status).toBe(401);
    expect(
      (await call(() => prefsPost(apiEvent(user, { category: 'marketing', enabled: true })))).status
    ).toBe(400);
    expect((await call(() => prefsPost(apiEvent(seed('helper', null).user, body)))).status).toBe(
      409
    );
  });

  it('a fresh opt-in lifts an earlier provider unsubscribe for that address', async () => {
    const { user, ownerId } = seed();
    recordSuppression({
      address: user.email!,
      channel: 'email',
      reason: 'unsubscribe',
      source: 't'
    });
    await call(
      () => prefsPost(apiEvent(user, { category: 'frost-tonight', enabled: true })),
      ownerId
    );
    expect(isEmailSuppressed(user.email!)).toBe(false);
  });
});

describe('POST /api/email/test', () => {
  it('needs an opt-in first, then sends one opt-in email with unsubscribe headers', async () => {
    const { user, ownerId, userId } = seed();
    expect((await call(() => testPost(apiEvent(user)), ownerId)).status).toBe(409);
    runWithTenant(ownerId, () => optIn(userId, 'decon-due', { source: 'settings' }));
    const res = await call(() => testPost(apiEvent(user)), ownerId);
    expect(res.status).toBe(200);
    const [mail] = readOutbox(user.email!);
    expect(mail.headers['List-Unsubscribe']).toMatch(/\/api\/email\/unsubscribe\?t=u1\./);
    expect(mail.body).toContain('/unsubscribe/u1.');
  });

  it('stops after three test emails an hour with a plain 429', async () => {
    testEmailLimiter.reset();
    const { user, ownerId, userId } = seed();
    runWithTenant(ownerId, () => optIn(userId, 'decon-due', { source: 'settings' }));
    for (let i = 0; i < 3; i++) {
      expect((await call(() => testPost(apiEvent(user)), ownerId)).status).toBe(200);
    }
    const blocked = await call(() => testPost(apiEvent(user)), ownerId);
    expect(blocked.status).toBe(429);
    expect(JSON.stringify(blocked.body)).toContain('Try again in an hour');
    expect(readOutbox(user.email!)).toHaveLength(3);
  });
});

describe('createSendLimiter', () => {
  it('holds each window separately and frees up as time passes', () => {
    const lim = createSendLimiter([
      { ms: 1000, max: 2 },
      { ms: 10_000, max: 3 }
    ]);
    expect(lim.tryTake('a', 0)).toBe(true);
    expect(lim.tryTake('a', 1)).toBe(true);
    expect(lim.tryTake('a', 2)).toBe(false);
    expect(lim.tryTake('b', 2)).toBe(true);
    expect(lim.tryTake('a', 1500)).toBe(true);
    expect(lim.tryTake('a', 3000)).toBe(false);
    expect(lim.tryTake('a', 11_000)).toBe(true);
  });
});

describe('RFC 8058 one-click endpoint', () => {
  function oneClick(token: string | null, body = 'List-Unsubscribe=One-Click') {
    const url = new URL('http://localhost/api/email/unsubscribe');
    if (token) url.searchParams.set('t', token);
    return {
      url,
      request: new Request(url, {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/x-www-form-urlencoded' }
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it('turns the category off without a session, idempotently', async () => {
    const { ownerId, userId } = seed();
    runWithTenant(ownerId, () => {
      optIn(userId, 'decon-due', { source: 'settings' });
      optIn(userId, 'frost-tonight', { source: 'settings' });
    });
    const token = signUnsubscribeToken({ userId, ownerId, scope: 'decon-due' });
    const first = await oneClickPost(oneClick(token));
    expect(await first.json()).toEqual({ ok: true, turnedOff: ['decon-due'] });
    const again = await oneClickPost(oneClick(token));
    expect(await again.json()).toEqual({ ok: true, turnedOff: [] });
    const fd = new FormData();
    fd.set('List-Unsubscribe', 'One-Click');
    const url = new URL('http://localhost/api/email/unsubscribe');
    url.searchParams.set('t', signUnsubscribeToken({ userId, ownerId, scope: 'frost-tonight' }));
    const multipart = await oneClickPost({
      url,
      request: new Request(url, { method: 'POST', body: fd })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(await multipart.json()).toEqual({ ok: true, turnedOff: ['frost-tonight'] });
    const prefs = runWithTenant(ownerId, () => getEmailPrefsForUser(userId));
    expect(prefs['decon-due']).toBe(false);
    expect(prefs['frost-tonight']).toBe(false);
  });

  it('rejects forged tokens and non one-click bodies; GET changes nothing', async () => {
    const { ownerId, userId } = seed();
    runWithTenant(ownerId, () => optIn(userId, 'decon-due', { source: 'settings' }));
    const token = signUnsubscribeToken({ userId, ownerId, scope: 'decon-due' });
    expect((await oneClickPost(oneClick(token.slice(0, -2) + 'xx'))).status).toBe(400);
    expect((await oneClickPost(oneClick(null))).status).toBe(400);
    expect((await oneClickPost(oneClick(token, 'hello'))).status).toBe(400);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const get = await oneClickGet({ url: oneClick(token).url } as any);
    expect(get.status).toBe(303);
    expect(get.headers.get('location')).toBe(`/unsubscribe/${encodeURIComponent(token)}`);
    expect(runWithTenant(ownerId, () => getEmailPrefsForUser(userId))['decon-due']).toBe(true);
  });
});

describe('/unsubscribe/[token] page', () => {
  function pageEvent(token: string, form: Record<string, string | string[]> = {}) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) {
      for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
    }
    return {
      params: { token },
      getClientAddress: () => '203.0.113.50',
      request: new Request('http://localhost/unsubscribe/x', { method: 'POST', body: fd })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = (name: 'unsubscribe' | 'resubscribe', ev: any) => (actions[name] as any)(ev);

  it('GET shows what will change without changing it', async () => {
    const { ownerId, userId } = seed();
    runWithTenant(ownerId, () => optIn(userId, 'decon-due', { source: 'settings' }));
    const token = signUnsubscribeToken({ userId, ownerId, scope: 'decon-due' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await (load as any)({ params: { token } })) as Record<string, unknown>;
    expect(data).toMatchObject({
      status: 'ready',
      scope: 'decon-due',
      farmName: 'Safe Haven Farm'
    });
    expect(runWithTenant(ownerId, () => getEmailPrefsForUser(userId))['decon-due']).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await (load as any)({ params: { token: 'nope' } })).toEqual({ status: 'invalid' });
  });

  it('unsubscribes, is idempotent, and re-subscribes only what the token covers', async () => {
    const { ownerId, userId } = seed();
    runWithTenant(ownerId, () => {
      optIn(userId, 'decon-due', { source: 'settings' });
      optIn(userId, 'frost-tonight', { source: 'settings' });
    });
    const token = signUnsubscribeToken({ userId, ownerId, scope: 'decon-due' });
    expect(await run('unsubscribe', pageEvent(token))).toMatchObject({
      done: 'unsubscribed',
      turnedOff: ['decon-due']
    });
    expect(await run('unsubscribe', pageEvent(token))).toMatchObject({ turnedOff: [] });
    const back = await run(
      'resubscribe',
      pageEvent(token, { category: ['decon-due', 'spring-calibration'] })
    );
    expect(back).toMatchObject({ done: 'resubscribed', turnedOn: ['decon-due'] });
    const prefs = runWithTenant(ownerId, () => getEmailPrefsForUser(userId));
    expect(prefs).toMatchObject({ 'decon-due': true, 'spring-calibration': false });
    const history = runWithTenant(ownerId, () => listConsentHistoryForUser(userId));
    expect(history.find((h) => h.category === 'decon-due')).toMatchObject({
      optedInSource: 'unsubscribe-page',
      optedInIp: '203.0.113.50'
    });
  });

  it('"turn off everything" clears every category for this farm only', async () => {
    const { ownerId, userId } = seed();
    const other = `route-owner-${randomUUID()}`;
    db.insert(owners).values({ id: other, name: 'Other', slug: other }).run();
    const scopes: UnsubscribeScope[] = ['decon-due', 'lock-window-closing'];
    runWithTenant(ownerId, () =>
      scopes.forEach((c) => optIn(userId, c as never, { source: 'settings' }))
    );
    runWithTenant(other, () => optIn(userId, 'decon-due', { source: 'settings' }));
    const token = signUnsubscribeToken({ userId, ownerId, scope: 'decon-due' });
    const res = await run('unsubscribe', pageEvent(token, { everything: '1' }));
    expect((res as { turnedOff: string[] }).turnedOff.sort()).toEqual([...scopes].sort());
    expect(runWithTenant(other, () => getEmailPrefsForUser(userId))['decon-due']).toBe(true);
  });

  it('an old link cannot restart mail after the undo window or clear a provider unsubscribe', async () => {
    const { ownerId, userId } = seed();
    runWithTenant(ownerId, () => optIn(userId, 'decon-due', { source: 'settings' }));
    const token = signUnsubscribeToken({ userId, ownerId, scope: 'decon-due' });
    runWithTenant(ownerId, () =>
      optOut(userId, 'decon-due', { source: 'one-click', at: Date.now() - 20 * 60_000 })
    );
    expect(await run('resubscribe', pageEvent(token, { category: 'decon-due' }))).toMatchObject({
      status: 400
    });
    expect(runWithTenant(ownerId, () => getEmailPrefsForUser(userId))['decon-due']).toBe(false);

    runWithTenant(ownerId, () => optIn(userId, 'decon-due', { source: 'settings' }));
    runWithTenant(ownerId, () => optOut(userId, 'decon-due', { source: 'settings' }));
    expect(await run('resubscribe', pageEvent(token, { category: 'decon-due' }))).toMatchObject({
      status: 400
    });
  });

  it('asks for a choice when nothing was picked', async () => {
    const { ownerId, userId } = seed();
    const token = signUnsubscribeToken({ userId, ownerId, scope: 'all' });
    const res = await run('resubscribe', pageEvent(token));
    expect(res).toMatchObject({ status: 400 });
    expect((res as { data: { error: string } }).data.error).toContain('Pick at least one');
  });

  it('refuses a forged token and re-subscribing someone who left the farm', async () => {
    const { ownerId } = seed();
    expect(await run('unsubscribe', pageEvent('u1.forged.sig'))).toMatchObject({ status: 400 });
    const token = signUnsubscribeToken({ userId: 'not-a-member', ownerId, scope: 'decon-due' });
    expect(await run('resubscribe', pageEvent(token, { category: 'decon-due' }))).toMatchObject({
      status: 409
    });
  });
});

describe('POST /api/email/pingram-webhook', () => {
  function req(body: string, headers: Record<string, string>) {
    return {
      request: new Request('http://x/api/email/pingram-webhook', { method: 'POST', body, headers })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it('answers 503 until the secret is configured', async () => {
    vi.stubEnv('PINGRAM_WEBHOOK_SECRET', '');
    expect((await webhookPost(req('{}', {}))).status).toBe(503);
  });

  it('rejects an unsigned body and applies a signed one', async () => {
    vi.stubEnv('PINGRAM_WEBHOOK_SECRET', 'whsec_route');
    const addr = `hook-${randomUUID()}@example.test`;
    const body = JSON.stringify({ eventType: 'EMAIL_UNSUBSCRIBE', userId: addr });
    expect((await webhookPost(req(body, {}))).status).toBe(400);
    expect(isEmailSuppressed(addr)).toBe(false);
    const id = `evt_${randomUUID()}`;
    const ts = String(Date.now());
    const ok = await webhookPost(
      req(body, {
        'x-pingram-id': id,
        'x-pingram-timestamp': ts,
        'x-pingram-signature': signPingramPayload(id, ts, body, 'whsec_route')
      })
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ received: true, outcome: 'recorded' });
    expect(isEmailSuppressed(addr)).toBe(true);
  });
});
