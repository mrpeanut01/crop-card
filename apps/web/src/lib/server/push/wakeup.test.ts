// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { POST } from '../../../routes/api/internal/push-tick/+server';
import { PUSH_TICK_CRON_UTC } from './triggers';
import {
  INTERNAL_TICK_PATH,
  TICK_SECRET_HEADER,
  isInternalTickRequest,
  readTickSecret,
  runScheduledTick,
  tickSecretMatches
} from './wakeup';

const SECRET = 'a'.repeat(22) + 'Bz9-_x0q1w2e3r4t5y6u7i8o';

function call(headers: Record<string, string>) {
  const request = new Request(`http://localhost${INTERNAL_TICK_PATH}`, {
    method: 'POST',
    headers
  });
  return POST({ request } as unknown as RequestEvent);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('push-tick secret', () => {
  it('treats a missing or short secret as unset', () => {
    expect(readTickSecret({})).toBeNull();
    expect(readTickSecret({ PUSH_TICK_SECRET: '   ' })).toBeNull();
    expect(readTickSecret({ PUSH_TICK_SECRET: 'short' })).toBeNull();
    expect(readTickSecret({ PUSH_TICK_SECRET: ` ${SECRET} ` })).toBe(SECRET);
  });

  it('compares exactly, whatever the lengths', () => {
    expect(tickSecretMatches(SECRET, SECRET)).toBe(true);
    expect(tickSecretMatches(null, SECRET)).toBe(false);
    expect(tickSecretMatches('', SECRET)).toBe(false);
    expect(tickSecretMatches(SECRET.slice(0, -1), SECRET)).toBe(false);
    expect(tickSecretMatches(SECRET + 'x', SECRET)).toBe(false);
  });

  it('bypasses the session pipeline only for the tick path carrying the header', () => {
    const withHeader = new Headers({ [TICK_SECRET_HEADER]: 'anything' });
    expect(isInternalTickRequest(INTERNAL_TICK_PATH, withHeader)).toBe(true);
    expect(isInternalTickRequest(INTERNAL_TICK_PATH, new Headers())).toBe(false);
    expect(isInternalTickRequest(`${INTERNAL_TICK_PATH}/x`, withHeader)).toBe(false);
    expect(isInternalTickRequest('/api/tasks', withHeader)).toBe(false);
  });
});

describe('POST /api/internal/push-tick', () => {
  it('is 404 when no secret is configured, even with a header', async () => {
    vi.stubEnv('PUSH_TICK_SECRET', '');
    const res = await call({ [TICK_SECRET_HEADER]: SECRET });
    expect(res.status).toBe(404);
  });

  it('is 404 for a wrong or missing secret', async () => {
    vi.stubEnv('PUSH_TICK_SECRET', SECRET);
    expect((await call({ [TICK_SECRET_HEADER]: 'nope' })).status).toBe(404);
    expect((await call({})).status).toBe(404);
    expect((await call({ authorization: `Bearer ${SECRET}` })).status).toBe(404);
  });

  it('runs one tick and reports it', async () => {
    vi.stubEnv('PUSH_TICK_SECRET', SECRET);
    vi.stubEnv('VAPID_PUBLIC_KEY', '');
    const res = await call({ [TICK_SECRET_HEADER]: SECRET });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      joined: false,
      push: { skipped: 'vapid-not-configured' }
    });
  });
});

describe('runScheduledTick', () => {
  it('overlapping calls join the running tick instead of starting another', async () => {
    const env = {};
    const [a, b] = await Promise.all([runScheduledTick({ env }), runScheduledTick({ env })]);
    expect([a.joined, b.joined].sort()).toEqual([false, true]);
    expect(b.startedAt).toBe(a.startedAt);
    const c = await runScheduledTick({ env });
    expect(c.joined).toBe(false);
  });
});

describe('infra drift', () => {
  it('the Container Apps Job runs on the cadence the alert timings assume', () => {
    const bicep = readFileSync(
      new URL('../../../../../../infra/azure/main.bicep', import.meta.url),
      'utf8'
    );
    expect(bicep).toContain(`cronExpression: '${PUSH_TICK_CRON_UTC}'`);
    expect(bicep).toContain(INTERNAL_TICK_PATH);
    expect(bicep).toContain(TICK_SECRET_HEADER);
  });
});
