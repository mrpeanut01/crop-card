// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ impersonating: false, wiped: 0 }));

vi.mock('$lib/server/auth', () => ({
  currentUser: () => ({ id: 'wipe-owner', role: 'owner', impersonating: m.impersonating })
}));
vi.mock('$lib/db/admin', () => ({
  wipeAllData: () => {
    m.wiped++;
    return { ok: true };
  }
}));

import { POST } from './+server';

async function wipe(locals: Record<string, unknown> = {}) {
  const res = await POST({
    locals,
    request: new Request('http://localhost/api/admin/wipe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: 'WIPE-EVERYTHING' })
    })
  } as never);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('POST /api/admin/wipe (C-35 review round 1)', () => {
  it('refuses an API token and an impersonating superadmin, and lets the owner wipe', async () => {
    const token = await wipe({ authVia: 'bearer' });
    expect(token).toMatchObject({ status: 403, body: { code: 'INTERACTIVE_OWNER_ONLY' } });
    m.impersonating = true;
    expect((await wipe()).status).toBe(403);
    m.impersonating = false;
    expect(m.wiped).toBe(0);
    expect((await wipe()).status).toBe(200);
    expect(m.wiped).toBe(1);
  });
});
