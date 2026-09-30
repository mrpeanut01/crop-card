// 32F, F5-9: the language picker on /settings/account.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/client';
import { owners, users } from '$lib/db/schema';
import { addAssignment } from '$lib/db/users';
import { actions, load } from './+page.server';

function seed() {
  const ownerId = `loc-owner-${randomUUID().slice(0, 8)}`;
  const userId = `loc-user-${randomUUID().slice(0, 8)}`;
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .run();
  db.insert(users)
    .values({ id: userId, email: `${userId}@test` })
    .run();
  addAssignment({ ownerId, userId, roleWithinOwner: 'helper' });
  return { ownerId, userId };
}

function event(
  userId: string,
  ownerId: string,
  opts: { locale?: string; authVia?: 'cookie' | 'bearer'; impersonating?: boolean } = {}
) {
  const set = vi.fn();
  const fd = new FormData();
  if (opts.locale !== undefined) fd.set('locale', opts.locale);
  const locals = {
    locale: 'en',
    authVia: opts.authVia ?? 'cookie',
    user: {
      id: userId,
      email: `${userId}@test`,
      phone: null,
      role: 'helper',
      activeOwnerId: ownerId,
      isSuperadmin: false,
      impersonating: opts.impersonating === true
    }
  };
  return {
    set,
    locals,
    ev: {
      locals,
      cookies: { set },
      request: new Request('http://localhost/settings/account?/locale', {
        method: 'POST',
        body: fd
      })
    } as unknown as Parameters<(typeof actions)['locale']>[0]
  };
}

const saved = (userId: string) =>
  db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).get()?.locale;

describe('/settings/account language', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('hides the picker while English is the only enabled language', () => {
    vi.stubEnv('CROPCARD_LOCALES', '');
    const { userId, ownerId } = seed();
    const data = load(event(userId, ownerId).ev as never) as { language: unknown };
    expect(data.language).toBeNull();
  });

  it('lists enabled languages by their own names when Spanish is on', () => {
    vi.stubEnv('CROPCARD_LOCALES', 'en,es');
    const { userId, ownerId } = seed();
    const data = load(event(userId, ownerId).ev as never) as {
      language: { current: string; choices: Array<{ id: string; name: string }> };
    };
    expect(data.language.choices).toEqual([
      { id: 'en', name: 'English' },
      { id: 'es', name: 'Español' }
    ]);
  });

  it('saves the choice to the user and the cookie', async () => {
    vi.stubEnv('CROPCARD_LOCALES', 'en,es');
    const { userId, ownerId } = seed();
    const e = event(userId, ownerId, { locale: 'es' });
    expect(await actions.locale(e.ev)).toEqual({ localeSaved: true });
    expect(saved(userId)).toBe('es');
    expect(e.set).toHaveBeenCalledWith('cc_locale', 'es', expect.objectContaining({ path: '/' }));
    expect(e.locals.locale).toBe('es');
  });

  it('refuses a language that is not enabled', async () => {
    vi.stubEnv('CROPCARD_LOCALES', '');
    const { userId, ownerId } = seed();
    const off = event(userId, ownerId, { locale: 'es' });
    expect(await actions.locale(off.ev)).toMatchObject({ status: 400 });
    vi.stubEnv('CROPCARD_LOCALES', 'en,es');
    const unknown = event(userId, ownerId, { locale: 'fr' });
    expect(await actions.locale(unknown.ev)).toMatchObject({ status: 400 });
    expect(saved(userId)).toBeNull();
    expect(off.set).not.toHaveBeenCalled();
  });

  it('is cookie sessions only, and never while impersonating', async () => {
    vi.stubEnv('CROPCARD_LOCALES', 'en,es');
    const { userId, ownerId } = seed();
    await expect(
      actions.locale(event(userId, ownerId, { locale: 'es', authVia: 'bearer' }).ev)
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      actions.locale(event(userId, ownerId, { locale: 'es', impersonating: true }).ev)
    ).rejects.toMatchObject({ status: 403 });
    expect(saved(userId)).toBeNull();
  });
});
