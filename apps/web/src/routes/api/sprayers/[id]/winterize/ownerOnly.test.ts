import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'helper',
  recordWinterization: vi.fn(() => ({ id: 's1' }))
}));

vi.mock('$lib/server/auth', () => ({
  requireMutator: () => ({ id: 'u', role: m.role })
}));
vi.mock('$lib/server/sprayers', () => ({
  getSprayer: vi.fn(() => ({ id: 's1' })),
  recordWinterization: m.recordWinterization
}));

import { POST } from './+server';

function post() {
  return POST({
    params: { id: 's1' },
    locals: { locale: 'en' },
    request: new Request('http://localhost/api/sprayers/s1/winterize', {
      method: 'POST',
      body: JSON.stringify({ steps: [{ key: 'rinse', kind: 'decon', label: 'Rinse' }] })
    })
  } as never) as Promise<Response>;
}

describe('POST /api/sprayers/:id/winterize', () => {
  beforeEach(() => m.recordWinterization.mockClear());

  it('refuses a helper: it would clear the decon state the owner records', async () => {
    m.role = 'helper';
    const res = await post();
    expect(res.status).toBe(403);
    expect((await res.json()).askOwner).toBe(true);
    expect(m.recordWinterization).not.toHaveBeenCalled();
  });

  it('records it for the owner', async () => {
    m.role = 'owner';
    expect((await post()).status).toBe(200);
    expect(m.recordWinterization).toHaveBeenCalledOnce();
  });
});
