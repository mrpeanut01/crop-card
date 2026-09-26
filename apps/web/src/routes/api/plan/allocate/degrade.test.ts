/**
 * #439 / Invariant 7 — /api/plan/allocate routes Claude through aiTry():
 * an unexpected upstream error degrades to the deterministic engine plan
 * (200, `meta.fallback`), never a 502.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  allocate: vi.fn(),
  allocateDeterministic: vi.fn(),
  checkGuard: vi.fn(),
  recordCall: vi.fn(),
  getApiKey: vi.fn(() => 'sk-test'),
  buildFarmContextWithCache: vi.fn(async () => ({
    context: {},
    cacheHit: false,
    contextVersion: 'v1'
  }))
}));

vi.mock('$lib/server/auth', () => ({ requireOwner: () => ({ id: 'u1', role: 'owner' }) }));
vi.mock('$lib/db/blocks', () => ({ listBlocks: () => [{ id: 'blk-1' }] }));
vi.mock('$lib/db/crops', () => ({ listCrops: () => [] }));
vi.mock('$lib/server/registry', () => ({
  getRegistry: async () => ({
    all: () => [{ plugin: { type: 'crop', pluginId: 'tomato' } }]
  })
}));
vi.mock('$lib/plugins/companionRelations', () => ({ companionIndex: () => ({}) }));
vi.mock('$lib/season/planningYear.server', () => ({ getActivePlanningYear: () => 2026 }));
vi.mock('$lib/server/aiContext', () => ({
  buildFarmContextWithCache: m.buildFarmContextWithCache
}));
vi.mock('$lib/server/aiAllocation', () => ({
  allocate: m.allocate,
  allocateDeterministic: m.allocateDeterministic
}));
vi.mock('$lib/server/aiGuard', () => ({ checkGuard: m.checkGuard, recordCall: m.recordCall }));
vi.mock('$lib/server/scanResult', () => ({ getApiKey: m.getApiKey }));

import { POST } from './+server';

const ENGINE = {
  assignments: [{ stockItemId: 's1', blockId: 'blk-1' }],
  unplaced: [],
  sufficiency: [],
  rationale: 'engine',
  perRowRationale: {},
  advisories: [],
  pollinationConstraints: [],
  geometryMissingBlockIds: [],
  companionGroups: [],
  meta: { model: 'engine-fallback', usdEstimate: 0, fallback: 'ai-unavailable' }
};

function post() {
  return POST({
    request: new Request('http://localhost/api/plan/allocate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        seedSelections: [
          {
            stockItemId: 's1',
            cropPluginId: 'tomato',
            varietyDisplayName: 'Brandywine',
            quantityPlants: 10
          }
        ],
        blockIds: ['blk-1']
      })
    })
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getApiKey.mockReturnValue('sk-test');
  m.checkGuard.mockReturnValue({
    ok: true,
    spend: { monthlyUsdSoFar: 0, cap: 5, warnAt80: false }
  });
  m.allocateDeterministic.mockReturnValue(ENGINE);
});

describe('/api/plan/allocate degradation', () => {
  it('an unexpected Anthropic error returns the engine plan, not a 502', async () => {
    m.allocate.mockRejectedValue(
      Object.assign(new Error('internal server error'), { status: 500 })
    );
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.fallback).toBe('ai-unavailable');
    expect(body.assignments).toHaveLength(1);
    expect(m.allocateDeterministic).toHaveBeenCalledWith(
      expect.anything(),
      'ai-unavailable',
      expect.stringMatching(/internal server error/)
    );
    expect(m.recordCall).toHaveBeenCalledWith(
      expect.objectContaining({ provenance: 'fallback', inputTokens: 0, outputTokens: 0 })
    );
  });

  it('no key → engine plan without building the Claude context', async () => {
    m.getApiKey.mockReturnValue('');
    const res = await post();
    expect(res.status).toBe(200);
    expect(m.allocateDeterministic).toHaveBeenCalledWith(
      expect.anything(),
      'no-api-key',
      undefined
    );
    expect(m.buildFarmContextWithCache).not.toHaveBeenCalled();
    expect(m.allocate).not.toHaveBeenCalled();
  });

  it('monthly cap reached → over-cap engine plan with the guard message', async () => {
    m.checkGuard.mockReturnValue({
      ok: false,
      reason: 'cap-exceeded',
      status: 402,
      message: 'Monthly AI cap reached'
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(m.allocateDeterministic).toHaveBeenCalledWith(expect.anything(), 'over-cap', undefined);
    expect((await res.json()).guardMessage).toMatch(/cap reached/);
    expect(m.allocate).not.toHaveBeenCalled();
  });

  it('daily quota reached → quota-exceeded engine plan', async () => {
    m.checkGuard.mockReturnValue({
      ok: false,
      reason: 'quota-exceeded',
      status: 429,
      message: 'Daily allocate quota reached'
    });
    await post();
    expect(m.allocateDeterministic).toHaveBeenCalledWith(
      expect.anything(),
      'quota-exceeded',
      undefined
    );
  });

  it('a successful Claude call is metered with provenance ai', async () => {
    m.allocate.mockResolvedValue({
      ...ENGINE,
      meta: {
        model: 'claude',
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        usdEstimate: 0.01
      }
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(m.recordCall).toHaveBeenCalledWith(
      expect.objectContaining({ provenance: 'ai', inputTokens: 10 })
    );
  });
});
