/**
 * The unsubscribe link, the RFC 8058 one-click POST and the Pingram webhook
 * must work with no session; nothing next to them should open up.
 */

import { describe, expect, it } from 'vitest';
import { csrfDecision, formCsrfForbidden, isAnonymous } from '../../src/hooks.server';

describe('email public paths', () => {
  it('lets the unsubscribe page, one-click endpoint and Pingram webhook through signed out', () => {
    expect(isAnonymous('/unsubscribe/u1.abc.def')).toBe(true);
    expect(isAnonymous('/api/email/unsubscribe')).toBe(true);
    expect(isAnonymous('/api/email/pingram-webhook')).toBe(true);
  });

  it('keeps the signed-in email endpoints and look-alike paths behind a session', () => {
    expect(isAnonymous('/unsubscribe')).toBe(false);
    expect(isAnonymous('/unsubscribe-all')).toBe(false);
    expect(isAnonymous('/api/email/prefs')).toBe(false);
    expect(isAnonymous('/api/email/test')).toBe(false);
    expect(isAnonymous('/api/email/unsubscribe/extra')).toBe(false);
  });

  it('a mail client one-click POST (no Origin) is not blocked as cross-site', () => {
    expect(
      csrfDecision({
        method: 'POST',
        pathname: '/api/email/unsubscribe',
        origin: null,
        host: 'app.cropcard.io'
      })
    ).toBe('allow');
  });
});

describe('cross-site form guard (moved from SvelteKit csrf.checkOrigin)', () => {
  const APP = 'https://app.cropcard.io';
  const base = {
    method: 'POST',
    pathname: '/settings/helpers',
    contentType: 'application/x-www-form-urlencoded',
    origin: APP,
    appOrigin: APP
  };

  it('keeps refusing cross-site and Origin-less form posts everywhere else', () => {
    expect(formCsrfForbidden(base)).toBe(false);
    expect(formCsrfForbidden({ ...base, origin: 'https://evil.example' })).toBe(true);
    expect(formCsrfForbidden({ ...base, origin: null })).toBe(true);
    for (const contentType of [
      'multipart/form-data; boundary=x',
      'text/plain;charset=UTF-8',
      'APPLICATION/X-WWW-FORM-URLENCODED',
      'application/x-sveltekit-formdata'
    ]) {
      expect(formCsrfForbidden({ ...base, contentType, origin: 'https://evil.example' })).toBe(
        true
      );
    }
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(formCsrfForbidden({ ...base, method, origin: null })).toBe(true);
    }
    expect(
      formCsrfForbidden({
        ...base,
        pathname: '/unsubscribe/u1.a.b',
        origin: 'https://evil.example'
      })
    ).toBe(true);
    expect(formCsrfForbidden({ ...base, pathname: '/api/email/unsubscribe/x', origin: null })).toBe(
      true
    );
  });

  it('leaves JSON, GET and the one-click unsubscribe endpoint alone', () => {
    expect(formCsrfForbidden({ ...base, contentType: 'application/json', origin: null })).toBe(
      false
    );
    expect(formCsrfForbidden({ ...base, contentType: null, origin: null })).toBe(false);
    expect(formCsrfForbidden({ ...base, method: 'GET', origin: null })).toBe(false);
    expect(formCsrfForbidden({ ...base, pathname: '/api/email/unsubscribe', origin: null })).toBe(
      false
    );
    expect(
      formCsrfForbidden({
        ...base,
        pathname: '/api/email/unsubscribe',
        contentType: 'multipart/form-data; boundary=z',
        origin: 'https://mail.google.com'
      })
    ).toBe(false);
  });
});
