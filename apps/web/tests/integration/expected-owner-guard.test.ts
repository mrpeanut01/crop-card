// @vitest-environment node
/**
 * Stale-tab guard at the request boundary (Invariant 6). An offline-queue
 * replay names the Owner its row was recorded under; when the session cookie
 * has since moved to another Owner (switch in a second tab) the request is
 * refused with 409 OWNER_MISMATCH before the endpoint runs.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { helperAssignments, owners, users } from '$lib/db/schema';
import { writeSession } from '$lib/server/session';
import { EXPECTED_OWNER_HEADER, OWNER_MISMATCH_CODE } from '$lib/client/ownerSync';
import { OWNER_HEADER } from '$lib/client/swTenantKey';
import { handle } from '../../src/hooks.server';
import { GET as activeOwnerGet } from '../../src/routes/api/session/active-owner/+server';

const ORIGIN = 'http://cropcard.test';

function uniq(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
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

function sessionOn(ownerId: string): RequestEvent['cookies'] {
  const userId = uniq('user');
  db.insert(owners).values({ id: ownerId, name: ownerId, slug: ownerId }).run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@example.test` })
    .run();
  db.insert(helperAssignments)
    .values({ ownerId, userId, roleWithinOwner: 'owner', status: 'active' })
    .run();
  const cookies = fakeCookies();
  writeSession(cookies, {
    id: userId,
    email: `${userId}@example.test`,
    phone: null,
    activeOwnerId: ownerId,
    activeRole: 'owner'
  });
  return cookies;
}

function event(
  cookies: RequestEvent['cookies'],
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {}
): RequestEvent {
  const url = new URL(path, ORIGIN);
  const method = init.method ?? 'GET';
  return {
    url,
    request: new Request(url, {
      method,
      headers: { origin: ORIGIN, 'content-type': 'application/json', ...init.headers },
      body: method === 'GET' ? undefined : '{}'
    }),
    cookies,
    locals: {},
    params: {},
    getClientAddress: () => '10.0.0.1'
  } as unknown as RequestEvent;
}

describe('expected-owner guard in hooks.server', () => {
  it('refuses a replay naming another Owner without running the endpoint', async () => {
    const ownerB = uniq('owner');
    const cookies = sessionOn(ownerB);
    let ran = false;
    const res = await handle({
      event: event(cookies, '/api/spray/record', {
        method: 'POST',
        headers: { [EXPECTED_OWNER_HEADER]: uniq('owner') }
      }),
      resolve: async () => {
        ran = true;
        return new Response('ok');
      }
    });
    expect(ran).toBe(false);
    expect(res.status).toBe(409);
    expect(res.headers.get(OWNER_HEADER)).toBe(ownerB);
    expect(await res.json()).toMatchObject({ code: OWNER_MISMATCH_CODE });
  });

  it('lets a matching replay and requests without the header through', async () => {
    const ownerA = uniq('owner');
    const cookies = sessionOn(ownerA);
    const variants: Record<string, string>[] = [{ [EXPECTED_OWNER_HEADER]: ownerA }, {}];
    for (const headers of variants) {
      let ran = false;
      const res = await handle({
        event: event(cookies, '/api/spray/record', { method: 'POST', headers }),
        resolve: async () => {
          ran = true;
          return new Response('ok');
        }
      });
      expect(ran).toBe(true);
      expect(res.status).toBe(200);
      expect(res.headers.get(OWNER_HEADER)).toBe(ownerA);
    }
  });
});

describe('GET /api/session/active-owner', () => {
  it('returns the session Owner, uncached, and tags the header through hooks', async () => {
    const ownerA = uniq('owner');
    const cookies = sessionOn(ownerA);
    const res = await handle({
      event: event(cookies, '/api/session/active-owner'),
      resolve: (ev) => activeOwnerGet(ev as never)
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get(OWNER_HEADER)).toBe(ownerA);
    expect(await res.json()).toEqual({ activeOwnerId: ownerA });
  });

  it('401s without a session', async () => {
    const res = await handle({
      event: event(fakeCookies(), '/api/session/active-owner'),
      resolve: (ev) => activeOwnerGet(ev as never)
    });
    expect(res.status).toBe(401);
  });
});
