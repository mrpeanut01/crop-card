import { beforeEach, describe, expect, it, vi } from 'vitest';

const user = { current: null as null | { id: string } };
const elevationFtAt = vi.fn(async (_lat: number, _lon: number): Promise<number | null> => 289.4);

vi.mock('$lib/server/auth', () => ({ currentUser: () => user.current }));
vi.mock('$lib/climate/elevation.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/climate/elevation.server')>();
  return { ...actual, elevationFtAt: (lat: number, lon: number) => elevationFtAt(lat, lon) };
});

import { GET } from './+server';
import { ELEVATION_PER_MINUTE, resetElevationRateLimit } from '$lib/climate/elevation.server';

function call(params: Record<string, string>) {
  const url = new URL('https://app.test/api/climate/elevation');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return GET({ url } as any) as Promise<Response>;
}

beforeEach(() => {
  user.current = { id: 'user-elev' };
  elevationFtAt.mockClear();
  resetElevationRateLimit();
});

describe('GET /api/climate/elevation', () => {
  it('requires a signed-in user', async () => {
    user.current = null;
    expect((await call({ lat: '38.9', lon: '-77.4' })).status).toBe(401);
    expect(elevationFtAt).not.toHaveBeenCalled();
  });

  it('rejects missing or out-of-range coordinates', async () => {
    for (const p of <Record<string, string>[]>[
      {},
      { lat: '38.9' },
      { lat: '91', lon: '0' },
      { lat: '0', lon: '181' },
      { lat: 'x', lon: '1' }
    ]) {
      expect((await call(p)).status).toBe(400);
    }
    expect(elevationFtAt).not.toHaveBeenCalled();
  });

  it('returns the elevation and its source, or null when unknown', async () => {
    const res = await call({ lat: '38.9408', lon: '-77.4636' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ elevationFt: 289.4, source: 'USGS 3DEP' });
    expect(elevationFtAt).toHaveBeenCalledWith(38.9408, -77.4636);

    elevationFtAt.mockResolvedValueOnce(null);
    expect(await (await call({ lat: '30', lon: '-60' })).json()).toEqual({
      elevationFt: null,
      source: null
    });
  });

  it('rate-limits per user', async () => {
    for (let i = 0; i < ELEVATION_PER_MINUTE; i++) {
      expect((await call({ lat: '38.9', lon: '-77.4' })).status).toBe(200);
    }
    expect((await call({ lat: '38.9', lon: '-77.4' })).status).toBe(429);
  });
});
