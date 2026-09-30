/**
 * 32F, F5-3: the request's language comes from the saved choice, the
 * `cc_locale` cookie, then `Accept-Language`, and only from enabled locales.
 * With the flag at its default nothing but English ever resolves.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { requestLocale } from '../../src/hooks.server';
import type { AuthenticatedUser } from '../../src/lib/server/auth';

function event(opts: { cookie?: string; accept?: string } = {}): RequestEvent {
  return {
    cookies: { get: (name: string) => (name === 'cc_locale' ? opts.cookie : undefined) },
    request: new Request('http://localhost/today', {
      headers: opts.accept ? { 'accept-language': opts.accept } : {}
    })
  } as unknown as RequestEvent;
}

const user = (locale: string | null): AuthenticatedUser => ({
  id: 'u1',
  email: 'u1@test',
  phone: null,
  role: 'owner',
  activeOwnerId: 'o1',
  isSuperadmin: false,
  impersonating: false,
  locale
});

describe('requestLocale', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is English whatever the request says when the flag is unset', () => {
    vi.stubEnv('CROPCARD_LOCALES', '');
    expect(requestLocale(event({ cookie: 'es', accept: 'es' }), user('es'))).toBe('en');
  });

  it('follows the saved choice, then the cookie, then the browser when Spanish is enabled', () => {
    vi.stubEnv('CROPCARD_LOCALES', 'en,es');
    expect(requestLocale(event({ cookie: 'es', accept: 'es' }), user('en'))).toBe('en');
    expect(requestLocale(event({ cookie: 'es', accept: 'en' }), user(null))).toBe('es');
    expect(requestLocale(event({ accept: 'es-MX,es;q=0.9' }), null)).toBe('es');
    expect(requestLocale(event({ accept: 'fr' }), null)).toBe('en');
  });
});
