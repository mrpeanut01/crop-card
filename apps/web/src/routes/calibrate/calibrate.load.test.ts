import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/sprayers', () => ({
  listSprayers: () => [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' }
  ]
}));
vi.mock('$lib/server/pendingCalibrations', () => ({ listPendingCalibrations: () => [] }));

const { load } = await import('./+page.server');

const run = (search: string) =>
  load({
    locals: { user: { role: 'owner' } },
    url: new URL(`http://x/calibrate${search}`)
  } as never) as { initialSprayerId: string | null };

describe('/calibrate loader', () => {
  it('opens the wizard on the sprayer the link names', () => {
    expect(run('?sprayer=b').initialSprayerId).toBe('b');
  });

  it('ignores an unknown or missing sprayer', () => {
    expect(run('?sprayer=zzz').initialSprayerId).toBeNull();
    expect(run('').initialSprayerId).toBeNull();
  });
});
