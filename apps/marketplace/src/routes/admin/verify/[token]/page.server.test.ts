import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  redeemLoginToken: vi.fn(),
  writeAdminSession: vi.fn()
}));

vi.mock('$lib/server/adminAuth', () => ({
  redeemLoginToken: mocks.redeemLoginToken
}));
vi.mock('$lib/server/adminSession', () => ({
  writeAdminSession: mocks.writeAdminSession
}));

import { load } from './+page.server';

async function run(token: string): Promise<{ status: number; location?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (load as any)({ params: { token }, cookies: {} });
  } catch (e) {
    return e as { status: number; location?: string };
  }
  throw new Error('expected load to throw');
}

describe('/admin/verify/[token] (#232)', () => {
  beforeEach(() => {
    mocks.redeemLoginToken.mockReset();
    mocks.writeAdminSession.mockReset();
  });

  it('returns 400 (not 500) when redeemLoginToken throws', async () => {
    mocks.redeemLoginToken.mockImplementation(() => {
      throw new Error('SQLITE_CANTOPEN');
    });
    const out = await run('tok');
    expect(out.status).toBe(400);
    expect(mocks.writeAdminSession).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid or used token', async () => {
    mocks.redeemLoginToken.mockReturnValue(null);
    expect((await run('bad')).status).toBe(400);
    expect(mocks.writeAdminSession).not.toHaveBeenCalled();
  });

  it('writes the session and redirects to /admin on success', async () => {
    mocks.redeemLoginToken.mockReturnValue({
      adminUserId: 'a1',
      email: 'a@example.com'
    });
    const out = await run('good');
    expect(out).toMatchObject({ status: 303, location: '/admin' });
    expect(mocks.writeAdminSession).toHaveBeenCalledWith(
      {},
      { adminUserId: 'a1', email: 'a@example.com' }
    );
  });
});
