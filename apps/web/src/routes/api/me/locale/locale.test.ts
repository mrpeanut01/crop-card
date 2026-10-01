// The header EN / ES button and the onboarding question post here.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { users } from '$lib/db/schema';
import { ANY_ROLE_API_WRITES, allowsPartialSession } from '../../../../hooks.server';
import { POST } from './+server';

function seedUser() {
  const id = `loc-api-${randomUUID().slice(0, 8)}`;
  db.insert(users)
    .values({ id, email: `${id}@test` })
    .run();
  return id;
}

function call(
  userId: string,
  body: unknown,
  opts: { authVia?: 'cookie' | 'bearer'; impersonating?: boolean } = {}
) {
  const set = vi.fn();
  const ev = {
    locals: {
      locale: 'en',
      authVia: opts.authVia ?? 'cookie',
      user: {
        id: userId,
        email: `${userId}@test`,
        phone: null,
        role: 'owner',
        activeOwnerId: null,
        isSuperadmin: false,
        impersonating: opts.impersonating === true
      }
    },
    cookies: { set },
    request: new Request('http://localhost/api/me/locale', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })
  } as unknown as Parameters<typeof POST>[0];
  return { set, res: POST(ev) as Promise<Response> };
}

const saved = (id: string) =>
  db.select({ locale: users.locale }).from(users).where(eq(users.id, id)).get()?.locale;

describe('POST /api/me/locale', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('saves the language to the user and the cookie', async () => {
    vi.stubEnv('CROPCARD_LOCALES', 'en,es');
    const id = seedUser();
    const { res, set } = call(id, { locale: 'es' });
    expect(await (await res).json()).toEqual({ locale: 'es' });
    expect(saved(id)).toBe('es');
    expect(set).toHaveBeenCalledWith('cc_locale', 'es', expect.objectContaining({ path: '/' }));
  });

  it('keeps the choice in the cookie only for Bearer and impersonated sessions', async () => {
    vi.stubEnv('CROPCARD_LOCALES', 'en,es');
    const id = seedUser();
    for (const opts of [{ authVia: 'bearer' as const }, { impersonating: true }]) {
      const { res, set } = call(id, { locale: 'es' }, opts);
      expect((await res).status).toBe(200);
      expect(set).toHaveBeenCalled();
    }
    expect(saved(id)).toBeNull();
  });

  it('refuses a language that is off, unknown or malformed', async () => {
    const id = seedUser();
    vi.stubEnv('CROPCARD_LOCALES', '');
    expect((await call(id, { locale: 'es' }).res).status).toBe(400);
    vi.stubEnv('CROPCARD_LOCALES', 'en,es');
    expect((await call(id, { locale: 'fr' }).res).status).toBe(400);
    expect((await call(id, {}).res).status).toBe(400);
    expect((await call(id, 'not json').res).status).toBe(400);
    expect(saved(id)).toBeNull();
  });

  it('is open to a partial session and to inspectors', () => {
    expect(allowsPartialSession('/api/me/locale', false)).toBe(true);
    expect(ANY_ROLE_API_WRITES.has('/api/me/locale')).toBe(true);
  });
});
