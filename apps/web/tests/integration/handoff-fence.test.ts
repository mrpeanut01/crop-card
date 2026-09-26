import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { handle } from '../../src/hooks.server';
import { _fenceForTests, _resetHandoffForTests } from '../../src/lib/server/ops/handoff';

afterEach(() => _resetHandoffForTests());

function input(method: string, path = '/api/spray/record') {
  const request = new Request(`http://app.test${path}`, { method });
  const resolve = vi.fn(async () => new Response('resolved'));
  const event = {
    request,
    url: new URL(request.url),
    cookies: { get: () => undefined, delete: () => {}, set: () => {} },
    locals: {},
    isDataRequest: false
  } as unknown as RequestEvent;
  return { event, resolve };
}

describe('deploy handoff fence in hooks.server handle', () => {
  it('refuses writes before auth or routing runs', async () => {
    _fenceForTests();
    for (const path of ['/api/spray/record', '/settings/farm', '/api/billing/stripe-webhook']) {
      const i = input('POST', path);
      const res = await handle(i);
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBeTruthy();
      expect(i.resolve).not.toHaveBeenCalled();
    }
  });

  it('keeps serving reads while fenced', async () => {
    _fenceForTests();
    const i = input('GET', '/api/health');
    const res = await handle(i);
    expect(res.status).toBe(200);
    expect(i.resolve).toHaveBeenCalledTimes(1);
  });
});
