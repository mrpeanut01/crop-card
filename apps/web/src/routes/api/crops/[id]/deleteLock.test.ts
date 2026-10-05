import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/holdGuard', () => ({
  tryGuardedHoldWrite: async (_e: unknown, _u: unknown, fn: () => unknown) => ({
    ok: true,
    value: fn()
  })
}));

const { currentUser, cropHasLockedRecords, deleteCropCascade } = vi.hoisted(() => ({
  currentUser: vi.fn(),
  cropHasLockedRecords: vi.fn(),
  deleteCropCascade: vi.fn(() => ({ removed: { crops: 1 } }))
}));

vi.mock('$lib/server/auth', () => ({ currentUser }));
vi.mock('$lib/db/admin', () => ({ cropHasLockedRecords, deleteCropCascade }));
vi.mock('$lib/db/crops', () => ({ getCrop: vi.fn(() => ({ id: 'c1' })) }));

import { DELETE } from './+server';

function del() {
  return DELETE({
    params: { id: 'c1' },
    locals: { locale: 'en' },
    request: new Request('http://localhost/api/crops/c1', { method: 'DELETE' }),
    url: new URL('http://localhost/api/crops/c1')
  } as never) as Promise<Response>;
}

describe('DELETE /api/crops/:id and the FR-09 lock', () => {
  beforeEach(() => {
    deleteCropCascade.mockClear();
  });

  it('refuses a helper when the planting has locked records', async () => {
    currentUser.mockReturnValue({ id: 'h', role: 'helper' });
    cropHasLockedRecords.mockReturnValue(true);
    const res = await del();
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('RECORD_LOCKED');
    expect(deleteCropCascade).not.toHaveBeenCalled();
  });

  it('lets a helper delete a planting with nothing locked', async () => {
    currentUser.mockReturnValue({ id: 'h', role: 'helper' });
    cropHasLockedRecords.mockReturnValue(false);
    const res = await del();
    expect(res.status).toBe(200);
    expect(deleteCropCascade).toHaveBeenCalledWith('c1');
  });

  it('lets the owner delete a planting with locked records', async () => {
    currentUser.mockReturnValue({ id: 'o', role: 'owner' });
    cropHasLockedRecords.mockReturnValue(true);
    const res = await del();
    expect(res.status).toBe(200);
  });
});
