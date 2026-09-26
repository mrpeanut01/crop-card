import { describe, expect, it } from 'vitest';
import { handle, isAnonymous, isAnonymousRequest } from '../../src/hooks.server';

function anonEvent(pathname: string, isDataRequest: boolean) {
  const url = new URL(`http://localhost${pathname}`);
  return {
    url,
    request: new Request(url, { method: 'GET' }),
    cookies: { get: () => undefined, delete: () => undefined, set: () => undefined },
    locals: {},
    isDataRequest,
    params: {},
    route: { id: null }
  };
}

async function run(pathname: string, isDataRequest: boolean) {
  const resolve = () => new Response('resolved', { status: 200 });
  try {
    const res = await handle({ event: anonEvent(pathname, isDataRequest), resolve } as never);
    return { status: res.status, resolved: (await res.text()) === 'resolved' };
  } catch (e) {
    return { status: (e as { status: number }).status, resolved: false };
  }
}

describe('offline Cards shell through the request boundary', () => {
  it('the data-free /cards shell is reachable without a session so the SW can precache it', async () => {
    expect(isAnonymousRequest('/cards', false)).toBe(true);
    expect(await run('/cards', false)).toEqual({ status: 200, resolved: true });
  });

  it('a /cards data request arrives as "/cards" and still needs a session', async () => {
    expect(isAnonymousRequest('/cards', true)).toBe(false);
    const res = await run('/cards', true);
    expect(res.resolved).toBe(false);
    expect([303, 401]).toContain(res.status);
  });

  it('every other /cards path still requires a session', async () => {
    expect(isAnonymous('/cards/planting/pl_1')).toBe(false);
    expect(isAnonymous('/api/cards/snapshot')).toBe(false);
    expect(isAnonymous('/c/pl_1')).toBe(false);
    expect((await run('/cards/planting/pl_1', false)).resolved).toBe(false);
    expect((await run('/api/cards/snapshot', false)).status).toBe(401);
  });
});
