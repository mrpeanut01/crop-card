/**
 * CSRF / Origin bridge — six-scenario matrix (Phase 24, Sub-task B / #56).
 *
 * SvelteKit's built-in `csrf.checkOrigin` is disabled in svelte.config.js;
 * the real guard is the `csrfDecision()` helper in hooks.server.ts. This
 * test exercises that helper directly so we get fast, hermetic coverage
 * of every (authVia × Origin × path) corner without spinning up the
 * SvelteKit server.
 *
 * Six scenarios per the Phase 24 epic:
 *
 *   1. Cookie POST under /api/** with matching Origin → 200 (allow)
 *   2. Cookie POST under /api/** with foreign Origin   → 403 (block)
 *   3. Cookie POST under /api/** with no Origin        → 200 (allow — curl)
 *   4. Bearer POST under /api/** with foreign Origin   → 200 (allow)
 *   5. Bearer POST under /api/** with no Origin        → 200 (allow)
 *   6. Form-action POST under /settings/** with foreign Origin AND Bearer
 *      set → 403 (block — Bearer bypass is /api/** only)
 *
 * Plus a malformed-Origin path that surfaces a 400 instead of a 403.
 */

import { describe, expect, it } from 'vitest';
import { csrfDecision } from '../../src/hooks.server';

const APP_HOST = 'app.cropcard.local';

describe('CSRF / Origin bridge — six-scenario matrix', () => {
  it('scenario 1 — cookie POST under /api/** with matching Origin → allow', () => {
    expect(
      csrfDecision({
        method: 'POST',
        pathname: '/api/spray/record',
        origin: `https://${APP_HOST}`,
        host: APP_HOST,
        authVia: 'cookie'
      })
    ).toBe('allow');
  });

  it('scenario 2 — cookie POST under /api/** with foreign Origin → block', () => {
    expect(
      csrfDecision({
        method: 'POST',
        pathname: '/api/spray/record',
        origin: 'https://evil.example',
        host: APP_HOST,
        authVia: 'cookie'
      })
    ).toBe('block-cross-origin');
  });

  it('scenario 3 — cookie POST under /api/** with no Origin → allow (curl)', () => {
    // No Origin header is the curl / server-to-server case; treating it
    // as "not a browser, not a CSRF vector" matches SvelteKit's pre-Phase-24
    // behavior and how every other JSON API in this repo expects to be
    // called.
    expect(
      csrfDecision({
        method: 'POST',
        pathname: '/api/spray/record',
        origin: null,
        host: APP_HOST,
        authVia: 'cookie'
      })
    ).toBe('allow');
  });

  it('scenario 4 — Bearer POST under /api/** with foreign Origin → allow', () => {
    // External agents call from arbitrary origins by design.
    expect(
      csrfDecision({
        method: 'POST',
        pathname: '/api/spray/record',
        origin: 'https://my-agent.example',
        host: APP_HOST,
        authVia: 'bearer'
      })
    ).toBe('allow');
  });

  it('scenario 5 — Bearer POST under /api/** with no Origin → allow', () => {
    expect(
      csrfDecision({
        method: 'POST',
        pathname: '/api/spray/record',
        origin: null,
        host: APP_HOST,
        authVia: 'bearer'
      })
    ).toBe('allow');
  });

  it('scenario 6 — form-action under /settings/** with foreign Origin AND Bearer → block', () => {
    // The Bearer bypass is /api/** only. A POST to a SvelteKit form-action
    // (e.g., /settings/season?/setup) belongs to the cookie-session UI;
    // it should never accept cross-origin requests even if the caller
    // happens to attach a Bearer.
    expect(
      csrfDecision({
        method: 'POST',
        pathname: '/settings/season',
        origin: 'https://evil.example',
        host: APP_HOST,
        authVia: 'bearer'
      })
    ).toBe('block-cross-origin');
  });
});

describe('CSRF / Origin bridge — additional edges', () => {
  it('non-mutation method always allows', () => {
    expect(
      csrfDecision({
        method: 'GET',
        pathname: '/api/spray/record',
        origin: 'https://evil.example',
        host: APP_HOST,
        authVia: 'cookie'
      })
    ).toBe('allow');
  });

  it('malformed Origin header surfaces a 400 signal, not a 403', () => {
    expect(
      csrfDecision({
        method: 'POST',
        pathname: '/api/spray/record',
        origin: 'http://[invalid',
        host: APP_HOST,
        authVia: 'cookie'
      })
    ).toBe('malformed-origin');
  });

  it('Origin matching with port + scheme passes (matched host)', () => {
    expect(
      csrfDecision({
        method: 'POST',
        pathname: '/api/spray/record',
        origin: 'http://localhost:5173',
        host: 'localhost:5173',
        authVia: 'cookie'
      })
    ).toBe('allow');
  });

  it('Origin host mismatch with same domain different port → block', () => {
    expect(
      csrfDecision({
        method: 'POST',
        pathname: '/api/spray/record',
        origin: 'http://localhost:5174',
        host: 'localhost:5173',
        authVia: 'cookie'
      })
    ).toBe('block-cross-origin');
  });

  it('PUT / PATCH / DELETE follow the same policy as POST', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      // Foreign Origin + cookie → block.
      expect(
        csrfDecision({
          method,
          pathname: '/api/spray/record',
          origin: 'https://evil.example',
          host: APP_HOST,
          authVia: 'cookie'
        })
      ).toBe('block-cross-origin');
      // Foreign Origin + Bearer → allow under /api/**.
      expect(
        csrfDecision({
          method,
          pathname: '/api/spray/record',
          origin: 'https://my-agent.example',
          host: APP_HOST,
          authVia: 'bearer'
        })
      ).toBe('allow');
    }
  });

  it('undefined authVia defaults to the cookie-strict policy', () => {
    // Treat "unknown auth state" as the safer default — same-origin only.
    expect(
      csrfDecision({
        method: 'POST',
        pathname: '/api/spray/record',
        origin: 'https://evil.example',
        host: APP_HOST,
        authVia: undefined
      })
    ).toBe('block-cross-origin');
  });
});
