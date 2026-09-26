import { beforeEach, describe, expect, it, vi } from 'vitest';

const user = { current: null as null | { id: string } };
const geocodeAddress = vi.fn(async (q: string) => [{ label: q.toUpperCase(), lat: 39, lon: -77 }]);

vi.mock('$lib/server/auth', () => ({ currentUser: () => user.current }));
vi.mock('$lib/server/geocode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/geocode')>();
  return { ...actual, geocodeAddress: (q: string) => geocodeAddress(q) };
});

import { GET } from './+server';
import { GEOCODE_PER_MINUTE, resetGeocodeRateLimit } from '$lib/server/geocode';

function call(q: string | null) {
  const url = new URL('https://app.test/api/geocode');
  if (q !== null) url.searchParams.set('q', q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return GET({ url } as any) as Promise<Response>;
}

beforeEach(() => {
  user.current = { id: 'user-geo' };
  geocodeAddress.mockClear();
  resetGeocodeRateLimit();
});

describe('GET /api/geocode', () => {
  it('requires a signed-in user', async () => {
    user.current = null;
    const res = await call('1 Main St');
    expect(res.status).toBe(401);
    expect(geocodeAddress).not.toHaveBeenCalled();
  });

  it('rejects a missing or too-short query', async () => {
    expect((await call(null)).status).toBe(400);
    expect((await call('ab')).status).toBe(400);
    expect(geocodeAddress).not.toHaveBeenCalled();
  });

  it('returns matches', async () => {
    const res = await call('1 main st');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ matches: [{ label: '1 MAIN ST', lat: 39, lon: -77 }] });
  });

  it('rate-limits per user', async () => {
    for (let i = 0; i < GEOCODE_PER_MINUTE; i++) expect((await call('1 Main St')).status).toBe(200);
    expect((await call('1 Main St')).status).toBe(429);
    user.current = { id: 'someone-else' };
    expect((await call('1 Main St')).status).toBe(200);
  });
});
