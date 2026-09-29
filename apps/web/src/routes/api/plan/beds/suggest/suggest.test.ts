import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getApiKey: vi.fn(() => ''),
  guard: vi.fn(),
  recordCall: vi.fn(),
  suggestBedLayout: vi.fn(),
  getStockItem: vi.fn()
}));

const LETTUCE = {
  pluginId: 'lettuce',
  type: 'crop',
  displayName: 'Lettuce',
  cropFamily: 'leafy-green',
  plantingGuide: { inRowSpacingIn: { min: 10, max: 10 }, rowSpacingIn: 12 }
};

vi.mock('$lib/server/scanResult', () => ({ getApiKey: m.getApiKey }));
vi.mock('$lib/server/aiGuard', () => ({
  checkGuard: m.guard,
  reserveGuard: m.guard,
  recordCall: m.recordCall
}));
vi.mock('$lib/server/auth', () => ({ requireOwner: vi.fn(() => ({ id: 'u1', role: 'owner' })) }));
vi.mock('$lib/server/registry', () => ({
  getRegistry: vi.fn(async () => ({
    get: (id: string) => (id === 'lettuce' ? { plugin: LETTUCE } : undefined)
  }))
}));
vi.mock('$lib/db/stock', () => ({ getStockItem: m.getStockItem }));
vi.mock('$lib/server/aiBedLayout', () => ({ suggestBedLayout: m.suggestBedLayout }));

import { POST } from './+server';

const META = {
  model: 'm',
  inputTokens: 10,
  cachedInputTokens: 0,
  outputTokens: 10,
  usdEstimate: 0.001
};
const OK = { ok: true, spend: { monthlyUsdSoFar: 0, cap: 5, warnAt80: false } };

function ev(body: unknown) {
  return {
    request: new Request('http://localhost/api/plan/beds/suggest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as never;
}

const BODY = { seeds: [{ stockItemId: 'seed-1', plants: 60 }], bedWidthFt: 4, maxBedLengthFt: 25 };

beforeEach(() => {
  vi.clearAllMocks();
  m.getApiKey.mockReturnValue('');
  m.guard.mockReturnValue(OK);
  m.getStockItem.mockImplementation((id: string) =>
    id === 'seed-1'
      ? {
          id,
          category: 'seed',
          displayName: 'Lettuce seed',
          shortName: 'Lettuce',
          pluginId: 'lettuce'
        }
      : undefined
  );
});

describe('POST /api/plan/beds/suggest (#475)', () => {
  it('answers with spacing-sized beds and never calls Claude without a key', async () => {
    const res = await POST(ev(BODY));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.provenance).toBe('fallback');
    expect(body.beds).toEqual([
      {
        widthFt: 4,
        lengthFt: 13,
        crops: [{ key: 'seed-1', name: 'Lettuce', plants: 60, rows: 4, lengthFt: 13 }]
      }
    ]);
    expect(body.message).toMatch(/^Claude is off/);
    expect(m.suggestBedLayout).not.toHaveBeenCalled();
  });

  it("uses Claude's grouping when every bed checks out", async () => {
    m.getApiKey.mockReturnValue('k');
    m.suggestBedLayout.mockResolvedValue({
      beds: [
        { widthFt: 4, lengthFt: 8, crops: [{ key: 'seed-1', plants: 30 }] },
        { widthFt: 4, lengthFt: 8, crops: [{ key: 'seed-1', plants: 30 }] }
      ],
      note: 'Two short beds are easier to reach.',
      meta: META
    });
    const body = await (await POST(ev(BODY))).json();
    expect(body.provenance).toBe('ai');
    expect(body.beds).toHaveLength(2);
    expect(body.beds[0].crops[0]).toMatchObject({ rows: 4, lengthFt: 7 });
    expect(m.recordCall).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'garden-fill', provenance: 'ai' })
    );
  });

  it('falls back to the plain plan when Claude leaves seed out or crams a bed', async () => {
    m.getApiKey.mockReturnValue('k');
    m.suggestBedLayout.mockResolvedValue({
      beds: [{ widthFt: 4, lengthFt: 3, crops: [{ key: 'seed-1', plants: 60 }] }],
      note: null,
      meta: META
    });
    const body = await (await POST(ev(BODY))).json();
    expect(body.provenance).toBe('fallback');
    expect(body.message).toMatch(/didn't fit your seed/);
    expect(body.beds[0].lengthFt).toBe(13);
  });

  it("falls back when Claude's bed runs past the owner's longest bed (r6 regression)", async () => {
    m.getApiKey.mockReturnValue('k');
    m.suggestBedLayout.mockResolvedValue({
      beds: [{ widthFt: 4, lengthFt: 80, crops: [{ key: 'seed-1', plants: 60 }] }],
      note: null,
      meta: META
    });
    const body = await (await POST(ev(BODY))).json();
    expect(body.provenance).toBe('fallback');
    expect(body.beds.every((b: { lengthFt: number }) => b.lengthFt <= 25)).toBe(true);
    expect(m.recordCall).toHaveBeenCalledWith(expect.objectContaining({ provenance: 'fallback' }));
  });

  it('says how much seed is left out when it needs more than 20 beds (r6 regression)', async () => {
    m.getApiKey.mockReturnValue('k');
    const body = await (
      await POST(ev({ ...BODY, seeds: [{ stockItemId: 'seed-1', plants: 20_000 }] }))
    ).json();
    expect(body.provenance).toBe('fallback');
    expect(body.beds).toHaveLength(20);
    const placed = body.beds
      .flatMap((b: { crops: Array<{ plants: number }> }) => b.crops)
      .reduce((n: number, c: { plants: number }) => n + c.plants, 0);
    expect(body.unplaced).toEqual([{ key: 'seed-1', name: 'Lettuce', plants: 20_000 - placed }]);
    expect(body.message).toContain(`leave out ${20_000 - placed} Lettuce plants`);
    expect(m.suggestBedLayout).not.toHaveBeenCalled();
  });

  it('refuses a seed id that is not a seed on this farm', async () => {
    const res = await POST(ev({ ...BODY, seeds: [{ stockItemId: 'other-farm', plants: 5 }] }));
    expect(res.status).toBe(404);
  });
});
