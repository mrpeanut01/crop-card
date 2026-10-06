// @vitest-environment node
/**
 * Demo farms: one throwaway Owner per visitor, signed in with a short
 * cookie, walled off from anything outward-facing, and deleted on reset,
 * on leaving, or once its time is up.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isActionFailure, isRedirect, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { crops, helperAssignments, owners, tasks, users } from '$lib/db/schema';
import { readSession, writeSession } from '$lib/server/session';
import { runWithTenant, tenantWhere } from '$lib/db/tenant';
import { DEMO_TTL_MS, isDemoEmail, isDemoOwnerId } from '$lib/demo/identity';
import { DEMO_FARM_NAME } from '$lib/db/demo/seed';
import { resetDemoLimiterForTest } from '$lib/server/demo/lifecycle';
import { actions as demoActions } from '../../src/routes/demo/+page.server';
import { handle, isAnonymous } from '../../src/hooks.server';

const ORIGIN = 'http://cropcard.test';

type Cookies = RequestEvent['cookies'];

function fakeCookies(): Cookies {
  const store = new Map<string, string>();
  return {
    get: (name: string) => store.get(name),
    getAll: () => [...store.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void store.set(name, value),
    delete: (name: string) => void store.delete(name),
    serialize: () => ''
  } as unknown as Cookies;
}

function makeEvent(
  method: string,
  path: string,
  cookies: Cookies,
  ip = '10.1.0.1',
  extraHeaders: Record<string, string> = {}
): RequestEvent {
  const url = new URL(path, ORIGIN);
  const form = method === 'POST' && !path.startsWith('/api/');
  return {
    url,
    request: new Request(url, {
      method,
      headers: {
        origin: ORIGIN,
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        ...(method !== 'GET' && !form ? { 'content-type': 'application/json' } : {}),
        ...extraHeaders
      },
      body: method === 'GET' ? undefined : form ? '' : '{}'
    }),
    cookies,
    locals: {},
    params: {},
    isDataRequest: false,
    getClientAddress: () => ip
  } as unknown as RequestEvent;
}

/** Runs the request boundary, then hands the vetted event to `inner`. */
async function through(
  event: RequestEvent,
  inner: (ev: RequestEvent) => Promise<Response> = async () => new Response('ok')
): Promise<{ res?: Response; thrown?: unknown }> {
  try {
    return { res: await handle({ event, resolve: inner }) };
  } catch (thrown) {
    return { thrown };
  }
}

async function startDemo(cookies: Cookies, ip = `10.2.${Math.floor(Math.random() * 250)}.1`) {
  const { thrown } = await through(makeEvent('POST', '/demo?/start', cookies, ip), async (ev) => {
    await demoActions.start(ev as never);
    return new Response('no redirect');
  });
  return thrown;
}

function ownerRow(id: string) {
  return db.select().from(owners).where(eq(owners.id, id)).get();
}

beforeEach(() => {
  resetDemoLimiterForTest();
  delete process.env.DEMO_MODE;
});
afterEach(() => {
  delete process.env.DEMO_MODE;
});

describe('starting a demo', () => {
  it('creates a seeded farm, signs it in with a 4-hour cookie and lands on /today', async () => {
    const cookies = fakeCookies();
    const before = Date.now();
    const thrown = await startDemo(cookies);
    expect(isRedirect(thrown) && thrown.location).toBe('/today');

    const session = readSession(cookies)!;
    expect(isDemoOwnerId(session.activeOwnerId)).toBe(true);
    expect(isDemoEmail(session.email)).toBe(true);
    expect(session.activeRole).toBe('owner');
    expect(session.exp).toBeGreaterThanOrEqual(before + DEMO_TTL_MS - 1000);
    expect(session.exp).toBeLessThanOrEqual(Date.now() + DEMO_TTL_MS);

    const owner = ownerRow(session.activeOwnerId!)!;
    expect(owner.name).toBe(DEMO_FARM_NAME);
    expect(
      runWithTenant(owner.id, () => db.select().from(crops).where(tenantWhere(crops)).all()).length
    ).toBeGreaterThan(5);
    expect(
      runWithTenant(owner.id, () => db.select().from(tasks).where(tenantWhere(tasks)).all()).length
    ).toBeGreaterThan(5);

    let seen: RequestEvent | null = null;
    const { res } = await through(makeEvent('GET', '/today', cookies), async (ev) => {
      seen = ev;
      return new Response('ok');
    });
    expect(res?.status).toBe(200);
    expect(seen!.locals.user).toMatchObject({ activeOwnerId: owner.id, role: 'owner' });
  });

  it('every visitor gets a separate farm', async () => {
    const a = fakeCookies();
    const b = fakeCookies();
    await startDemo(a);
    await startDemo(b);
    expect(readSession(a)!.activeOwnerId).not.toBe(readSession(b)!.activeOwnerId);
  });

  it('is public, and refuses when switched off or started too often from one address', async () => {
    expect(isAnonymous('/demo')).toBe(true);
    process.env.DEMO_MODE = 'off';
    const off = await through(makeEvent('POST', '/demo?/start', fakeCookies()), async (ev) => {
      const r = await demoActions.start(ev as never);
      expect(isActionFailure(r) && r.status).toBe(404);
      return new Response('done');
    });
    expect(off.res?.status).toBe(200);
    delete process.env.DEMO_MODE;

    const ip = `10.9.${Math.floor(Math.random() * 250)}.9`;
    for (let i = 0; i < 6; i++) expect(isRedirect(await startDemo(fakeCookies(), ip))).toBe(true);
    const limited = await through(
      makeEvent('POST', '/demo?/start', fakeCookies(), ip),
      async (ev) => {
        const r = await demoActions.start(ev as never);
        expect(isActionFailure(r) && r.status).toBe(429);
        return new Response('done');
      }
    );
    expect(limited.res?.status).toBe(200);
    // Seeds six whole demo farms: about 0.7 s alone, past 4 s in a loaded full run.
  }, 30_000);

  it('a signed-in grower is sent to their own farm instead', async () => {
    const userId = `u-${randomUUID()}`;
    const ownerId = `owner_${randomUUID().slice(0, 8)}`;
    db.insert(users)
      .values({ id: userId, email: `${userId}@example.com` })
      .run();
    db.insert(owners).values({ id: ownerId, name: 'Real', slug: ownerId }).run();
    db.insert(helperAssignments)
      .values({ ownerId, userId, roleWithinOwner: 'owner', status: 'active' })
      .run();
    const cookies = fakeCookies();
    writeSession(cookies, {
      id: userId,
      email: `${userId}@example.com`,
      phone: null,
      activeOwnerId: ownerId,
      activeRole: 'owner'
    });
    const thrown = await startDemo(cookies);
    expect(isRedirect(thrown) && thrown.location).toBe('/today');
    expect(readSession(cookies)!.activeOwnerId).toBe(ownerId);
  });
});

describe('inside a demo', () => {
  it('blocks outward-facing writes and allows farm writes', async () => {
    const cookies = fakeCookies();
    await startDemo(cookies);
    for (const path of [
      '/api/invites',
      '/api/billing/checkout',
      '/api/auth/token',
      '/api/push/subscribe'
    ]) {
      const { res } = await through(makeEvent('POST', path, cookies));
      expect(res?.status, path).toBe(403);
      expect(await res!.json()).toMatchObject({ code: 'DEMO_DISABLED' });
    }
    const action = await through(
      makeEvent('POST', '/settings/helpers?/invite', cookies, '10.1.0.1', {
        'x-sveltekit-action': 'true'
      })
    );
    expect(await action.res!.json()).toMatchObject({ type: 'failure', status: 403 });
    const { res } = await through(makeEvent('POST', '/api/spray/record', cookies));
    expect(res?.status).toBe(200);
  });

  it('reset deletes the old farm and starts a fresh one', async () => {
    const cookies = fakeCookies();
    await startDemo(cookies);
    const first = readSession(cookies)!;
    const { thrown } = await through(makeEvent('POST', '/demo?/reset', cookies), async (ev) => {
      await demoActions.reset(ev as never);
      return new Response('no redirect');
    });
    expect(isRedirect(thrown) && thrown.location).toBe('/today');
    const second = readSession(cookies)!;
    expect(second.activeOwnerId).not.toBe(first.activeOwnerId);
    expect(ownerRow(first.activeOwnerId!)).toBeUndefined();
    expect(db.select().from(users).where(eq(users.id, first.userId)).get()).toBeUndefined();
    expect(ownerRow(second.activeOwnerId!)).toBeDefined();
  });

  it('leaving deletes the farm and signs out', async () => {
    const cookies = fakeCookies();
    await startDemo(cookies);
    const { activeOwnerId } = readSession(cookies)!;
    const { thrown } = await through(makeEvent('POST', '/demo?/end', cookies), async (ev) => {
      await demoActions.end(ev as never);
      return new Response('no redirect');
    });
    expect(isRedirect(thrown) && thrown.location).toBe('/');
    expect(readSession(cookies)).toBeNull();
    expect(ownerRow(activeOwnerId!)).toBeUndefined();
  });

  it('an expired demo is erased on the next request and the visitor is sent to the landing page', async () => {
    const cookies = fakeCookies();
    await startDemo(cookies);
    const { activeOwnerId } = readSession(cookies)!;
    db.update(owners)
      .set({ createdAt: new Date(Date.now() - DEMO_TTL_MS - 1000) })
      .where(eq(owners.id, activeOwnerId!))
      .run();
    const { thrown } = await through(makeEvent('GET', '/today', cookies));
    expect(isRedirect(thrown) && thrown.location).toBe('/?demo=expired');
    expect(readSession(cookies)).toBeNull();
    expect(ownerRow(activeOwnerId!)).toBeUndefined();
  });
});
