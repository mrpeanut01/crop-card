// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import { listSeen, markSeen } from '$lib/db/userHints';
import { ANY_ROLE_API_WRITES, revalidateCookieUser } from '../../../../hooks.server';
import { POST } from './+server';

function seedUser(): string {
  const id = `tips-api-${randomUUID()}`;
  db.insert(users)
    .values({ id, email: `${id}@tips.test` })
    .run();
  return id;
}

const stored = (id: string) =>
  db.select({ v: users.beginnerTips }).from(users).where(eq(users.id, id)).get()?.v;

function event(
  opts: {
    userId?: string;
    role?: string;
    authVia?: 'cookie' | 'bearer';
    beginnerTips?: boolean;
    body?: unknown;
    raw?: string;
  } = {}
) {
  return {
    request: new Request('http://localhost/api/me/beginner-tips', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: opts.raw ?? JSON.stringify(opts.body ?? {})
    }),
    cookies: { get: () => undefined },
    locals: opts.userId
      ? {
          user: {
            id: opts.userId,
            email: null,
            phone: null,
            role: opts.role ?? 'helper',
            activeOwnerId: 'owner-tips',
            isSuperadmin: false,
            impersonating: false,
            authVia: opts.authVia ?? 'cookie',
            beginnerTips: opts.beginnerTips
          }
        }
      : {}
  } as never;
}

async function status(call: () => Response | Promise<Response>): Promise<number> {
  try {
    return (await call()).status;
  } catch (e) {
    if (isHttpError(e)) return e.status;
    throw e;
  }
}

describe('POST /api/me/beginner-tips', () => {
  it('401s when anonymous', async () => {
    expect(await status(() => POST(event({ body: { enabled: true } })))).toBe(401);
  });

  it('turns tips on and off for any farm role', async () => {
    for (const role of ['owner', 'helper', 'custom-operator']) {
      const u = seedUser();
      expect(stored(u)).toBeNull();
      const on = await POST(event({ userId: u, role, body: { enabled: true } }));
      expect(on.status).toBe(200);
      expect((await on.json()).enabled).toBe(true);
      expect(stored(u)).toBe(true);
      await POST(event({ userId: u, role, body: { enabled: false } }));
      expect(stored(u)).toBe(false);
    }
  });

  it('accepts a Bearer caller, as the hints endpoint does', async () => {
    const u = seedUser();
    const res = await POST(event({ userId: u, authVia: 'bearer', body: { enabled: true } }));
    expect(res.status).toBe(200);
    expect(stored(u)).toBe(true);
  });

  it('is not one of the writes open to inspectors, like the hints endpoint', () => {
    expect(ANY_ROLE_API_WRITES.has('/api/me/hints')).toBe(false);
    expect(ANY_ROLE_API_WRITES.has('/api/me/beginner-tips')).toBe(false);
  });

  it('reset forgets tip keys only and leaves the setting alone', async () => {
    const u = seedUser();
    const other = seedUser();
    for (const k of ['tip_today', 'tip_plan', 'tip_start_read', 'map_add', 'tipper'])
      markSeen(u, k);
    markSeen(other, 'tip_today');
    const res = await POST(event({ userId: u, beginnerTips: true, body: { reset: true } }));
    const body = await res.json();
    expect(body.forgotten).toBe(3);
    expect(body.enabled).toBe(true);
    expect(body.hints.map((h: { key: string }) => h.key).sort()).toEqual(['map_add', 'tipper']);
    expect(stored(u)).toBeNull();
    expect(listSeen(other).map((h) => h.key)).toEqual(['tip_today']);
  });

  it('does both in one call', async () => {
    const u = seedUser();
    markSeen(u, 'tip_spray');
    const res = await POST(event({ userId: u, body: { enabled: true, reset: true } }));
    expect((await res.json()).forgotten).toBe(1);
    expect(stored(u)).toBe(true);
    expect(listSeen(u)).toEqual([]);
  });

  it('400s on an empty body, unknown fields, wrong types and bad JSON', async () => {
    const u = seedUser();
    for (const body of [{}, { reset: false }, { enabled: 'yes' }, { enabled: true, extra: 1 }]) {
      expect(await status(() => POST(event({ userId: u, body })))).toBe(400);
    }
    expect(await status(() => POST(event({ userId: u, raw: '{' })))).toBe(400);
    expect(stored(u)).toBeNull();
  });
});

describe('the per-request user read', () => {
  const cookieUser = (id: string) => ({
    id,
    email: null,
    phone: null,
    role: 'owner' as const,
    activeOwnerId: null,
    isSuperadmin: false,
    impersonating: false
  });

  it('reads never asked and no as off, with no seen list', () => {
    const u = seedUser();
    markSeen(u, 'tip_today');
    expect(revalidateCookieUser(cookieUser(u))).toMatchObject({
      beginnerTips: false,
      seenTips: []
    });
    db.update(users).set({ beginnerTips: false }).where(eq(users.id, u)).run();
    expect(revalidateCookieUser(cookieUser(u))).toMatchObject({
      beginnerTips: false,
      seenTips: []
    });
  });

  it('carries the dismissed tips of a user with tips on, and only theirs', () => {
    const u = seedUser();
    const other = seedUser();
    db.update(users).set({ beginnerTips: true }).where(eq(users.id, u)).run();
    expect(revalidateCookieUser(cookieUser(u))).toMatchObject({ beginnerTips: true, seenTips: [] });
    for (const k of ['tip_today', 'tip_plan', 'map_add', 'tipper']) markSeen(u, k);
    markSeen(other, 'tip_spray');
    const fresh = revalidateCookieUser(cookieUser(u));
    expect(fresh?.beginnerTips).toBe(true);
    expect([...(fresh?.seenTips ?? [])].sort()).toEqual(['tip_plan', 'tip_today']);
  });
});
