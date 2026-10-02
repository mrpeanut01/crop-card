import { describe, expect, it } from 'vitest';
import { DEMO_BLOCKED_MESSAGE, demoBlockedResponse, demoBlocksWrite } from './guard';

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
    ['POST', '/api/scan-url'],
    ['POST', '/onboarding']
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

  it('says it in the visitor’s language', async () => {
    expect(await demoBlockedResponse('/api/invites', false, 'en').json()).toMatchObject({
      error: DEMO_BLOCKED_MESSAGE
    });
    const body = await demoBlockedResponse('/api/invites', false, 'es').json();
    expect(body.error).toMatch(/^No está disponible en la demo/);
  });
});
