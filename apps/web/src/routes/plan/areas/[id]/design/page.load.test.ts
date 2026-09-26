import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleSnapshot } from '$lib/cards/build/fixtures';

const env = vi.hoisted(() => ({ browser: true }));
const store = vi.hoisted(() => ({ row: null as unknown }));

vi.mock('$app/environment', () => ({
  get browser() {
    return env.browser;
  }
}));
vi.mock('$lib/client/cardStore', () => ({
  loadSnapshot: async () => store.row
}));

import { load } from './+page';

type LoadEvent = Parameters<typeof load>[0];

function event(fetchImpl: typeof fetch, search = ''): LoadEvent {
  return {
    fetch: fetchImpl,
    params: { id: 'f_garden' },
    url: new URL(`http://localhost/plan/areas/f_garden/design${search}`),
    parent: async () => ({ user: { role: 'helper' } })
  } as unknown as LoadEvent;
}

async function outcome(
  p: unknown
): Promise<{ status?: number; location?: string; data?: unknown }> {
  try {
    return { data: await p };
  } catch (e) {
    const err = e as { status?: number; location?: string };
    return { status: err.status, location: err.location };
  }
}

const offlineFetch = (async () => {
  throw new TypeError('Failed to fetch');
}) as typeof fetch;

describe('designer page load', () => {
  beforeEach(() => {
    env.browser = true;
    store.row = null;
    vi.stubGlobal('navigator', { onLine: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the endpoint when it answers, passing the season through', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ design: { asOf: 1 }, canEdit: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await outcome(load(event(fetchImpl, '?season=2027&on=2027-05-01')));
    expect(calls).toEqual(['/api/garden/areas/f_garden/design?season=2027']);
    expect(out.data).toMatchObject({ canEdit: true, offline: false });
  });

  it('turns 404 and 401 into the page 404 and a sign-in redirect', async () => {
    const answer = (status: number) =>
      (async () => new Response('{}', { status })) as unknown as typeof fetch;
    expect((await outcome(load(event(answer(404))))).status).toBe(404);
    expect(await outcome(load(event(answer(401))))).toMatchObject({ status: 303, location: '/' });
    expect((await outcome(load(event(answer(500))))).status).toBe(500);
  });

  it('builds the page read-only from the saved snapshot when there is no signal', async () => {
    store.row = { ownerId: 'o', etag: null, fetchedAt: 0, bundle: sampleSnapshot() };
    const out = await outcome(load(event(offlineFetch, '?season=2026')));
    expect(out.data).toMatchObject({
      offline: true,
      canEdit: false,
      role: 'helper',
      areaKind: 'garden'
    });
    const data = out.data as { design: { readOnlyReason: string; seasonYear: number } };
    expect(data.design.readOnlyReason).toBe('offline');
    expect(data.design.seasonYear).toBe(2026);
  });

  it('skips the network when the browser already knows it is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    store.row = { ownerId: 'o', etag: null, fetchedAt: 0, bundle: sampleSnapshot() };
    const fetchImpl = vi.fn(offlineFetch);
    const out = await outcome(load(event(fetchImpl as unknown as typeof fetch)));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out.data).toMatchObject({ offline: true });
  });

  it('says plainly when nothing is saved on this device, or the garden is not in it', async () => {
    expect((await outcome(load(event(offlineFetch)))).status).toBe(503);
    store.row = { ownerId: 'o', etag: null, fetchedAt: 0, bundle: sampleSnapshot({ areas: [] }) };
    expect((await outcome(load(event(offlineFetch)))).status).toBe(404);
  });

  it('never falls back to a snapshot on the server', async () => {
    env.browser = false;
    store.row = { ownerId: 'o', etag: null, fetchedAt: 0, bundle: sampleSnapshot() };
    expect((await outcome(load(event(offlineFetch)))).status).toBe(503);
  });
});
