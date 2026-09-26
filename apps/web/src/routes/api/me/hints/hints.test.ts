// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import { GET, POST } from './+server';

function seedUser(): string {
  const id = `hints-api-${randomUUID()}`;
  db.insert(users)
    .values({ id, email: `${id}@hints.test` })
    .run();
  return id;
}

function event(
  method: 'GET' | 'POST',
  opts: { userId?: string; authVia?: 'cookie' | 'bearer'; body?: unknown; raw?: string } = {}
) {
  const init: RequestInit = { method, headers: { 'content-type': 'application/json' } };
  if (method === 'POST') init.body = opts.raw ?? JSON.stringify(opts.body ?? {});
  return {
    request: new Request('http://localhost/api/me/hints', init),
    cookies: { get: () => undefined },
    locals: opts.userId
      ? {
          user: {
            id: opts.userId,
            email: null,
            phone: null,
            role: 'helper',
            activeOwnerId: 'owner-hints',
            isSuperadmin: false,
            impersonating: false,
            authVia: opts.authVia ?? 'cookie'
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

describe('/api/me/hints', () => {
  it('401s when anonymous', async () => {
    expect(await status(() => GET(event('GET')))).toBe(401);
    expect(await status(() => POST(event('POST', { body: { key: 'map_add' } })))).toBe(401);
  });

  it('marks and lists hints for a cookie user', async () => {
    const u = seedUser();
    const empty = await (await GET(event('GET', { userId: u }))).json();
    expect(empty.hints).toEqual([]);

    const res = await POST(event('POST', { userId: u, body: { key: 'map_add' } }));
    expect(res.status).toBe(200);
    const after = await (await GET(event('GET', { userId: u }))).json();
    expect(after.hints.map((h: { key: string }) => h.key)).toEqual(['map_add']);
  });

  it('accepts a batch from a bearer user and de-duplicates', async () => {
    const u = seedUser();
    const res = await POST(
      event('POST', {
        userId: u,
        authVia: 'bearer',
        body: { keys: ['map_filter', 'cards_offline', 'map_filter'] }
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hints.map((h: { key: string }) => h.key).sort()).toEqual([
      'cards_offline',
      'map_filter'
    ]);
  });

  it("never returns another user's hints", async () => {
    const a = seedUser();
    const b = seedUser();
    await POST(event('POST', { userId: a, body: { key: 'spray_first' } }));
    const seenByB = await (await GET(event('GET', { userId: b }))).json();
    expect(seenByB.hints).toEqual([]);
  });

  it.each([
    ['bad JSON', { raw: '{' }],
    ['missing key', { body: {} }],
    ['bad key shape', { body: { key: 'Map Add!' } }],
    ['empty batch', { body: { keys: [] } }],
    ['oversized batch', { body: { keys: Array.from({ length: 51 }, (_, i) => `k_${i}`) } }]
  ])('400s on %s', async (_label, opts) => {
    const u = seedUser();
    expect(await status(() => POST(event('POST', { userId: u, ...opts })))).toBe(400);
  });
});
