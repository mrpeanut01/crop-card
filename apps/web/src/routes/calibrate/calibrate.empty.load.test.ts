import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/sprayers', () => ({ listSprayers: () => [] }));
vi.mock('$lib/server/pendingCalibrations', () => ({ listPendingCalibrations: () => [] }));

const { load } = await import('./+page.server');

type Out = {
  sprayers: unknown[];
  setup: { canEdit: boolean; sprayerTemplates: Array<{ templateId: string }> };
};
const run = (role: string) =>
  load({
    locals: { user: { role } },
    url: new URL('http://x/calibrate')
  } as never) as Out;

describe('/calibrate with no sprayer (#647)', () => {
  it('offers the starter sprayer templates to the owner', () => {
    const out = run('owner');
    expect(out.sprayers).toEqual([]);
    expect(out.setup.canEdit).toBe(true);
    expect(out.setup.sprayerTemplates.map((t) => t.templateId)).toContain('sprayer-50gal-pull');
  });

  it('leaves a helper to ask the owner', () => {
    expect(run('helper').setup.canEdit).toBe(false);
  });
});
