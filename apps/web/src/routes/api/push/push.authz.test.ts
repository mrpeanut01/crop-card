// @vitest-environment node
/**
 * NFR-06 — auth / role / ownership gates on /api/push/**. The session layer
 * is mocked; the repo is replaced by an in-memory fake that records which
 * user id each call was scoped to.
 */
import { createECDH, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload, SessionRole } from '$lib/server/session';
import { DEFAULT_PUSH_PREFS, type PushPrefs } from '$lib/push/prefs';
import { generateVapidKeys } from '$lib/server/push/webPush';

let session: { userId: string; role: SessionRole } | null = null;

vi.mock('$lib/server/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/session')>();
  return {
    ...actual,
    readSession: (): SessionPayload | null =>
      session
        ? {
            userId: session.userId,
            email: `${session.userId}@push.test`,
            phone: null,
            isSuperadmin: false,
            activeOwnerId: 'owner-push',
            activeRole: session.role,
            impersonating: false,
            exp: Date.now() + 60_000
          }
        : null
  };
});

interface FakeSub {
  id: string;
  userId: string;
  endpoint: string;
  prefs: PushPrefs;
}
const store: FakeSub[] = [];
const view = (s: FakeSub) => ({
  ...s,
  ownerId: 'owner-push',
  p256dh: 'k',
  auth: 'a',
  createdAt: 0,
  lastSuccessAt: null,
  failureCount: 0
});

vi.mock('$lib/db/pushSubscriptions', () => ({
  getSubscriptionForUser: (userId: string, endpoint: string) => {
    const s = store.find((x) => x.userId === userId && x.endpoint === endpoint);
    return s ? view(s) : null;
  },
  upsertSubscription: (i: { userId: string; endpoint: string; prefs?: PushPrefs }) => {
    const s = {
      id: `sub-${store.length}`,
      userId: i.userId,
      endpoint: i.endpoint,
      prefs: i.prefs ?? { ...DEFAULT_PUSH_PREFS }
    };
    store.push(s);
    return view(s);
  },
  updatePrefsForUser: (userId: string, endpoint: string, prefs: PushPrefs) => {
    const s = store.find((x) => x.userId === userId && x.endpoint === endpoint);
    if (!s) return null;
    s.prefs = prefs;
    return view(s);
  },
  deleteSubscriptionForUser: (userId: string, endpoint: string) => {
    const i = store.findIndex((x) => x.userId === userId && x.endpoint === endpoint);
    if (i < 0) return false;
    store.splice(i, 1);
    return true;
  },
  listSubscriptionsForUser: (userId: string) => store.filter((x) => x.userId === userId).map(view)
}));

const sendToSubscriptions = vi.fn(async (subs: unknown[]) => ({
  sent: subs.length,
  removed: 0,
  failed: 0
}));
vi.mock('$lib/server/push/dispatch', () => ({
  sendToSubscriptions: (...args: unknown[]) => sendToSubscriptions(...(args as [unknown[]]))
}));

import { GET as vapidGet } from './vapid-public-key/+server';
import { DELETE as subDelete, PATCH as subPatch, POST as subPost } from './subscribe/+server';
import { POST as testPost } from './test/+server';

function makeEvent(body?: unknown) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cookies: { get: () => undefined } as any,
    locals: {},
    params: {},
    request: { json: async () => body ?? {} }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

async function call(fn: () => unknown): Promise<{ status: number; body: unknown }> {
  try {
    const res = (await fn()) as Response;
    return { status: res.status, body: await res.json() };
  } catch (e) {
    const h = e as { status?: number; body?: unknown };
    if (typeof h?.status === 'number') return { status: h.status, body: h.body };
    throw e;
  }
}

function subscriptionBody(endpoint = 'https://push.example.net/send/dev-1') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    subscription: {
      endpoint,
      keys: {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: randomBytes(16).toString('base64url')
      }
    }
  };
}

const keys = generateVapidKeys();
function configurePush(on: boolean) {
  if (on) {
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = 'mailto:ops@cropcard.test';
  } else {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  }
}

beforeEach(() => {
  store.length = 0;
  sendToSubscriptions.mockClear();
  session = { userId: 'user-helper', role: 'helper' };
  configurePush(true);
});
afterEach(() => configurePush(false));

describe('/api/push/vapid-public-key', () => {
  it('requires a session', async () => {
    session = null;
    expect((await call(() => vapidGet(makeEvent()))).status).toBe(401);
  });

  it('reports enabled + key, or disabled when VAPID is unset', async () => {
    expect((await call(() => vapidGet(makeEvent()))).body).toEqual({
      enabled: true,
      publicKey: keys.publicKey
    });
    configurePush(false);
    expect((await call(() => vapidGet(makeEvent()))).body).toEqual({
      enabled: false,
      publicKey: null
    });
  });
});

describe('/api/push/subscribe', () => {
  it('rejects anonymous and inspector callers', async () => {
    session = null;
    expect((await call(() => subPost(makeEvent(subscriptionBody())))).status).toBe(401);
    session = { userId: 'user-insp', role: 'inspector' };
    expect((await call(() => subPost(makeEvent(subscriptionBody())))).status).toBe(403);
    expect(store).toHaveLength(0);
  });

  it('a helper may subscribe for themselves; the row is keyed to the session user', async () => {
    const res = await call(() =>
      subPost(makeEvent({ ...subscriptionBody(), userId: 'user-owner' }))
    );
    expect(res.status).toBe(201);
    expect(store).toEqual([expect.objectContaining({ userId: 'user-helper' })]);
  });

  it('503 when push is not configured', async () => {
    configurePush(false);
    expect((await call(() => subPost(makeEvent(subscriptionBody())))).status).toBe(503);
  });

  it('400 on malformed subscriptions', async () => {
    const bad = subscriptionBody('http://insecure.example/x');
    expect((await call(() => subPost(makeEvent(bad)))).status).toBe(400);
    const shortKey = subscriptionBody();
    shortKey.subscription.keys.auth = 'AAAA';
    expect((await call(() => subPost(makeEvent(shortKey)))).status).toBe(400);
    expect((await call(() => subPost(makeEvent({ nope: true })))).status).toBe(400);
  });

  it("PATCH/DELETE only touch the caller's own row", async () => {
    const body = subscriptionBody();
    session = { userId: 'user-owner', role: 'owner' };
    await call(() => subPost(makeEvent(body)));
    session = { userId: 'user-helper', role: 'helper' };
    const endpoint = body.subscription.endpoint;
    expect(
      (await call(() => subPatch(makeEvent({ endpoint, prefs: { 'decon-due': false } })))).status
    ).toBe(404);
    expect((await call(() => subDelete(makeEvent({ endpoint })))).body).toEqual({ removed: false });
    expect(store).toHaveLength(1);

    session = { userId: 'user-owner', role: 'owner' };
    const patched = await call(() =>
      subPatch(makeEvent({ endpoint, prefs: { 'decon-due': false } }))
    );
    expect(patched.status).toBe(200);
    expect(store[0].prefs).toEqual({ ...DEFAULT_PUSH_PREFS, 'decon-due': false });
    expect(
      (await call(() => subPatch(makeEvent({ endpoint, prefs: { bogus: true } })))).status
    ).toBe(400);
    expect((await call(() => subDelete(makeEvent({ endpoint })))).body).toEqual({ removed: true });
  });
});

describe('/api/push/test', () => {
  it('sends only to the caller’s own subscriptions', async () => {
    session = { userId: 'user-owner', role: 'owner' };
    await call(() => subPost(makeEvent(subscriptionBody('https://push.example.net/o'))));
    session = { userId: 'user-helper', role: 'helper' };
    await call(() => subPost(makeEvent(subscriptionBody('https://push.example.net/h'))));
    const res = await call(() => testPost(makeEvent({})));
    expect(res.status).toBe(200);
    const [subs] = sendToSubscriptions.mock.calls[0] as unknown as [Array<{ userId: string }>];
    expect(subs.map((s) => s.userId)).toEqual(['user-helper']);
  });

  it('404 without a subscription, 503 without VAPID, 403 for inspectors', async () => {
    expect((await call(() => testPost(makeEvent({})))).status).toBe(404);
    configurePush(false);
    expect((await call(() => testPost(makeEvent({})))).status).toBe(503);
    configurePush(true);
    session = { userId: 'user-insp', role: 'inspector' };
    expect((await call(() => testPost(makeEvent({})))).status).toBe(403);
  });
});
