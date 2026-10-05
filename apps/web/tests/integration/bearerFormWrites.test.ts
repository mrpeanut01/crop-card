// @vitest-environment node
/**
 * API tokens drive /api/** only. A token POSTed at a form action that mints
 * a session cookie (Owner picker, invite accept, onboarding) must never come
 * back with a browser session. A script can send this app's own Origin, so
 * the cross-site form guard does not stop it.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { helperAssignments, owners, users } from '$lib/db/schema';
import { issueToken } from '$lib/server/apiTokens';
import { readSession } from '$lib/server/session';
import { bearerWriteOutsideApi, handle } from '../../src/hooks.server';
import { actions as pickerActions } from '../../src/routes/owner-picker/+page.server';

const ORIGIN = 'http://cropcard.test';

function uniq(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

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

function seedHelperOnTwoFarms() {
  const userId = uniq('user');
  const farmA = uniq('owner');
  const farmB = uniq('owner');
  db.insert(users)
    .values({ id: userId, email: `${userId}@example.test` })
    .run();
  for (const id of [farmA, farmB]) {
    db.insert(owners).values({ id, name: id, slug: id }).run();
    db.insert(helperAssignments)
      .values({ ownerId: id, userId, roleWithinOwner: 'owner', status: 'active' })
      .run();
  }
  const { token } = issueToken({ ownerId: farmA, userId, label: 'agent' });
  return { userId, farmA, farmB, token };
}

function bearerEvent(token: string, path: string, body: FormData) {
  const jar = fakeCookies();
  const url = new URL(path, ORIGIN);
  const event = {
    url,
    request: new Request(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, origin: ORIGIN },
      body
    }),
    cookies: jar.cookies,
    locals: {},
    params: {},
    isDataRequest: false,
    getClientAddress: () => '10.0.0.1'
  } as unknown as RequestEvent;
  return { event, jar };
}

describe('Bearer tokens outside /api/**', () => {
  it('refuses a form action before it can mint a session cookie', async () => {
    const { farmB, token } = seedHelperOnTwoFarms();
    const fd = new FormData();
    fd.set('ownerId', farmB);
    const { event, jar } = bearerEvent(token, '/owner-picker?/pick', fd);
    let ran = false;
    const res = await handle({
      event,
      resolve: async (ev) => {
        ran = true;
        try {
          await pickerActions.pick(ev as never);
        } catch {
          // redirect
        }
        return new Response('ok');
      }
    });
    expect(ran).toBe(false);
    expect(res.status).toBe(403);
    expect(readSession(jar.cookies)).toBeNull();
  });

  it('still lets the token call /api/**', async () => {
    const { token } = seedHelperOnTwoFarms();
    const { event } = bearerEvent(token, '/api/spray/record', new FormData());
    let ran = false;
    const res = await handle({
      event,
      resolve: async () => {
        ran = true;
        return new Response('ok');
      }
    });
    expect(ran).toBe(true);
    expect(res.status).toBe(200);
  });

  it('decision matrix', () => {
    expect(
      bearerWriteOutsideApi({ method: 'POST', pathname: '/owner-picker', authVia: 'bearer' })
    ).toBe(true);
    expect(bearerWriteOutsideApi({ method: 'GET', pathname: '/today', authVia: 'bearer' })).toBe(
      false
    );
    expect(
      bearerWriteOutsideApi({ method: 'POST', pathname: '/api/tasks', authVia: 'bearer' })
    ).toBe(false);
    expect(
      bearerWriteOutsideApi({ method: 'POST', pathname: '/owner-picker', authVia: 'cookie' })
    ).toBe(false);
  });
});
