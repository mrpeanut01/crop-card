import { describe, expect, it } from 'vitest';
import {
  DEMO_BLOCKED_MESSAGE,
  DEMO_BLOCKED_PARAM,
  demoBlockedResponse,
  demoBlocksWrite
} from './guard';

describe('demoBlocksWrite', () => {
  it.each([
    ['POST', '/api/invites'],
    ['DELETE', '/api/invites/abc'],
    ['POST', '/settings/helpers'],
    ['POST', '/api/auth/token'],
    ['POST', '/settings/api-tokens'],
    ['POST', '/api/account/identity'],
    ['POST', '/api/billing/checkout'],
    ['POST', '/api/billing/portal'],
    ['PUT', '/api/email/prefs'],
    ['POST', '/api/push/subscribe'],
    ['POST', '/settings/ai'],
    ['POST', '/api/plugins/upload'],
    ['POST', '/api/documents'],
    ['POST', '/api/scan-url']
  ])('blocks %s %s', (method, path) => {
    expect(demoBlocksWrite(method, path)).toBe(true);
  });

  it.each([
    ['GET', '/settings/helpers'],
    ['GET', '/api/documents'],
    ['POST', '/api/spray/record'],
    ['POST', '/api/tasks/close'],
    ['PATCH', '/api/blocks/b1'],
    ['POST', '/api/feedback'],
    ['POST', '/api/me/locale'],
    ['POST', '/onboarding'],
    ['POST', '/api/invitesx'],
    ['POST', '/settings/aim']
  ])('allows %s %s', (method, path) => {
    expect(demoBlocksWrite(method, path)).toBe(false);
  });
});

describe('demoBlockedResponse', () => {
  it('answers an API call with JSON 403', async () => {
    const res = demoBlockedResponse('/api/invites', false);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'DEMO_DISABLED' });
  });

  it('answers an enhanced form action with an action failure the page can show', async () => {
    const res = demoBlockedResponse('/settings/helpers', true);
    const body = await res.json();
    expect(body).toMatchObject({ type: 'failure', status: 403 });
    expect(JSON.parse(body.data)).toEqual([{ error: 1 }, DEMO_BLOCKED_MESSAGE]);
  });

  it('sends a plain page form back to its page instead of a raw JSON body (#717)', () => {
    for (const contentType of [
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=----x'
    ]) {
      const res = demoBlockedResponse('/settings/helpers', false, 'es', {
        method: 'POST',
        contentType
      });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(`/settings/helpers?${DEMO_BLOCKED_PARAM}=1`);
    }
  });

  it('keeps JSON for API paths and non-form bodies', async () => {
    const api = demoBlockedResponse('/api/invites', false, 'en', {
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded'
    });
    expect(api.status).toBe(403);
    const fetched = demoBlockedResponse('/settings/ai', false, 'en', {
      method: 'POST',
      contentType: 'application/json'
    });
    expect(fetched.status).toBe(403);
    expect(await fetched.json()).toMatchObject({ code: 'DEMO_DISABLED' });
    const del = demoBlockedResponse('/settings/ai', false, 'en', { method: 'DELETE' });
    expect(del.status).toBe(403);
  });

  it('says it in the visitor’s language', async () => {
    expect(await demoBlockedResponse('/api/invites', false, 'en').json()).toMatchObject({
      error: DEMO_BLOCKED_MESSAGE
    });
    const body = await demoBlockedResponse('/api/invites', false, 'es').json();
    expect(body.error).toMatch(/^No está disponible en la demo/);
  });
});
