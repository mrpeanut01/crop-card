import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/holdGuard', () => ({
  tryGuardedHoldWrite: async (_e: unknown, _u: unknown, fn: () => unknown) => ({
    ok: true,
    value: fn()
  })
}));

const { currentUser, getCutting, deleteHayCutting } = vi.hoisted(() => ({
  currentUser: vi.fn(),
  getCutting: vi.fn(),
  deleteHayCutting: vi.fn(() => ({ removed: { hay_cuttings: 1 } }))
}));

vi.mock('$lib/server/auth', () => ({ currentUser }));
vi.mock('$lib/db/hayCuttings', () => ({
  getCutting,
  advanceCutting: vi.fn(),
  abortCutting: vi.fn()
}));
vi.mock('$lib/db/admin', () => ({ deleteHayCutting }));

import { DELETE } from './[id]/+server';

const DAY = 86_400_000;

function del(query = '') {
  return DELETE({
    params: { id: 'cut-1' },
    locals: { locale: 'en' },
    request: new Request('http://localhost/api/hay/cuttings/cut-1', { method: 'DELETE' }),
    url: new URL(`http://localhost/api/hay/cuttings/cut-1${query}`)
  } as never) as Promise<Response>;
}

describe('DELETE /api/hay/cuttings/:id and the FR-09 lock', () => {
  beforeEach(() => {
    deleteHayCutting.mockClear();
  });

  it('404s an unknown cutting', async () => {
    currentUser.mockReturnValue({ id: 'o', role: 'owner' });
    getCutting.mockReturnValue(undefined);
    await expect(del()).rejects.toMatchObject({ status: 404 });
  });

  it('lets a helper delete a cutting inside the lock window', async () => {
    currentUser.mockReturnValue({ id: 'h', role: 'helper' });
    getCutting.mockReturnValue({ id: 'cut-1', mowAt: Date.now() - DAY, createdAt: Date.now() });
    expect((await del()).status).toBe(200);
    expect(deleteHayCutting).toHaveBeenCalledWith('cut-1');
  });

  it('refuses a helper once the cutting is locked', async () => {
    currentUser.mockReturnValue({ id: 'h', role: 'helper' });
    getCutting.mockReturnValue({ id: 'cut-1', mowAt: Date.now() - 3 * DAY, createdAt: Date.now() });
    const res = await del('?force=true');
    expect(res.status).toBe(403);
    expect(deleteHayCutting).not.toHaveBeenCalled();
  });

  it('asks the owner to force a locked delete', async () => {
    currentUser.mockReturnValue({ id: 'o', role: 'owner' });
    getCutting.mockReturnValue({ id: 'cut-1', mowAt: Date.now() - 3 * DAY, createdAt: Date.now() });
    expect((await del()).status).toBe(422);
    expect(deleteHayCutting).not.toHaveBeenCalled();
    expect((await del('?force=true')).status).toBe(200);
    expect(deleteHayCutting).toHaveBeenCalledWith('cut-1');
  });
});
