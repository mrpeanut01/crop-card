// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import { getFeedback } from '$lib/db/feedback';
import { POST } from './+server';

function seedUser(): string {
  const id = `fb-api-${randomUUID()}`;
  db.insert(users)
    .values({ id, email: `${id}@feedback.test` })
    .run();
  return id;
}

function event(opts: {
  userId?: string;
  role?: string;
  ownerId?: string | null;
  authVia?: 'cookie' | 'bearer';
  body?: unknown;
  raw?: string;
}) {
  return {
    request: new Request('http://localhost/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'UA/1.0' },
      body: opts.raw ?? JSON.stringify(opts.body ?? {})
    }),
    cookies: { get: () => undefined },
    locals: opts.userId
      ? {
          authVia: opts.authVia ?? 'cookie',
          user: {
            id: opts.userId,
            email: null,
            phone: null,
            role: opts.role ?? 'helper',
            activeOwnerId: opts.ownerId === undefined ? 'owner-fb' : opts.ownerId,
            isSuperadmin: false,
            impersonating: false
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

describe('POST /api/feedback', () => {
  it('401s when signed out', async () => {
    expect(await status(() => POST(event({ body: { kind: 'bug', message: 'hello' } })))).toBe(401);
  });

  it('refuses API tokens', async () => {
    const u = seedUser();
    expect(
      await status(() =>
        POST(event({ userId: u, authVia: 'bearer', body: { kind: 'bug', message: 'hello' } }))
      )
    ).toBe(403);
  });

  it('400s on bad JSON or a bad body', async () => {
    const u = seedUser();
    expect(await status(() => POST(event({ userId: u, raw: '{' })))).toBe(400);
    expect(await status(() => POST(event({ userId: u, body: { kind: 'bug' } })))).toBe(400);
  });

  it('saves a note from an inspector and from someone with no farm', async () => {
    const u = seedUser();
    const res = await POST(
      event({
        userId: u,
        role: 'inspector',
        body: { kind: 'idea', message: 'Export a PDF too', pagePath: '/records?show=100' }
      })
    );
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(getFeedback(id)).toMatchObject({
      role: 'inspector',
      pagePath: '/records',
      userAgent: 'UA/1.0',
      ownerId: 'owner-fb'
    });

    const noFarm = await POST(
      event({ userId: u, ownerId: null, body: { kind: 'other', message: 'Hello there' } })
    );
    expect(noFarm.status).toBe(201);
  });

  it('never posts a note to GitHub on arrival, even with GitHub set up (#466 review)', async () => {
    vi.stubEnv('GITHUB_FEEDBACK_TOKEN', 'tok');
    vi.stubEnv('GITHUB_FEEDBACK_REPO', 'me/crop-card');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const userId = seedUser();
    const res = await POST(
      event({ userId, body: { kind: 'bug', message: 'My address is 123 Old Ox Rd, call me' } })
    );
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
    const { id } = (await res.json()) as { id: string };
    expect(getFeedback(id)!.githubIssueUrl).toBeNull();
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
