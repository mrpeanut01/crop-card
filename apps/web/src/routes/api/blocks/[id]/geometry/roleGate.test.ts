import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  role: 'inspector',
  setBlockGeometry: vi.fn((id: string, geo: string | null) => ({ id, geometryGeojson: geo }))
}));

vi.mock('$lib/server/auth', async () => {
  const { error } = await import('@sveltejs/kit');
  return {
    requireOwner: () => {
      if (state.role !== 'owner') throw error(403, 'owner role required');
      return { id: 'u', role: state.role };
    }
  };
});
vi.mock('$lib/db/blocks', () => ({ setBlockGeometry: state.setBlockGeometry }));

import { DELETE, PUT } from './+server';

const polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 0]
    ]
  ]
};

function event(method: string) {
  return {
    params: { id: 'b1' },
    request: new Request('http://localhost/api/blocks/b1/geometry', {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'PUT' ? JSON.stringify(polygon) : undefined
    })
  } as never;
}

beforeEach(() => state.setBlockGeometry.mockClear());

async function status(run: () => Response | Promise<Response>): Promise<number> {
  try {
    return (await run()).status;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

describe('block geometry role gate', () => {
  it.each([
    ['inspector', 'PUT'],
    ['inspector', 'DELETE'],
    ['helper', 'PUT'],
    ['helper', 'DELETE']
  ] as const)('%s %s → 403, nothing written', async (role, m) => {
    state.role = role;
    expect(await status(() => (m === 'PUT' ? PUT(event(m)) : DELETE(event(m))))).toBe(403);
    expect(state.setBlockGeometry).not.toHaveBeenCalled();
  });

  it.each(['owner'])('%s can set geometry', async (role) => {
    state.role = role;
    const res = await PUT(event('PUT'));
    expect(res.status).toBe(200);
    expect(state.setBlockGeometry).toHaveBeenCalledOnce();
  });
});
