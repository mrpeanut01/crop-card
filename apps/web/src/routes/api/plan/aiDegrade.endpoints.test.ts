/**
 * Invariant 7 — the planning endpoints degrade instead of gating. No key,
 * a spent daily quota, or a reached monthly cap all return 200 with the
 * deterministic result (or the endpoint's empty shape), tagged
 * `provenance: 'fallback'` + `fallbackReason`, and never call Claude.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getApiKey: vi.fn(() => ''),
  checkGuard: vi.fn(),
  recordCall: vi.fn(),
  planInputsWithAI: vi.fn(),
  refineInputs: vi.fn(),
  planInputs: vi.fn(() => ({ deterministic: true })),
  schedulePlantings: vi.fn(),
  refineSchedule: vi.fn(),
  refineAllocation: vi.fn(),
  proposeGroupPlans: vi.fn(),
  proposePlansEngineOnly: vi.fn(),
  planWithAI: vi.fn()
}));

const CROP = {
  pluginId: 'corn',
  type: 'crop',
  displayName: 'Corn',
  cropFamily: 'corn',
  daysToMaturity: { min: 80, max: 90 },
  plantingGuide: { soilTempMinF: 50 }
};
const DRAFT = {
  id: 'c1',
  blockId: 'b1',
  cropPluginId: 'corn',
  varietyDisplayName: 'Golden',
  status: 'planned',
  groupId: null,
  plantingDate: null
};

vi.mock('$lib/server/scanResult', () => ({ getApiKey: m.getApiKey }));
vi.mock('$lib/server/aiGuard', () => ({ checkGuard: m.checkGuard, recordCall: m.recordCall }));
vi.mock('$lib/server/auth', () => ({
  requireOwner: vi.fn(() => ({ id: 'u1', role: 'owner' })),
  currentUser: vi.fn(() => ({ id: 'u1', role: 'owner' }))
}));
vi.mock('$lib/server/session', () => ({ canMutate: () => true }));
vi.mock('$lib/server/aiContext', () => ({
  buildFarmContextWithCache: vi.fn(async () => ({
    context: {},
    cacheHit: false,
    contextVersion: 'v1'
  })),
  buildFarmContext: vi.fn(async () => ({}))
}));
vi.mock('$lib/server/registry', () => ({
  getRegistry: vi.fn(async () => ({
    all: () => [{ plugin: CROP }],
    get: () => ({ plugin: CROP })
  }))
}));
vi.mock('$lib/db/blocks', () => ({
  listBlocks: vi.fn(() => [{ id: 'b1', name: 'B1', plantings: [] }])
}));
vi.mock('$lib/db/crops', () => ({
  listCrops: vi.fn(() => [DRAFT]),
  getCrop: vi.fn(() => DRAFT)
}));
vi.mock('$lib/db/stock', () => ({ listStockItems: vi.fn(() => []) }));
vi.mock('$lib/db/fertility', () => ({
  listSoilTestsForBlock: vi.fn(() => []),
  listFertilityCreditsForBlock: vi.fn(() => [])
}));
vi.mock('$lib/season/setup.server', () => ({ loadSeasonSetup: vi.fn(() => ({})) }));
vi.mock('$lib/schedule/settings', () => ({
  frostDatesForYear: vi.fn(() => ({
    lastSpringFrostMs: Date.UTC(2027, 3, 15),
    firstFallFrostMs: Date.UTC(2027, 9, 15)
  }))
}));
vi.mock('$lib/server/aiInputsPlan', () => ({
  planInputsWithAI: m.planInputsWithAI,
  refineInputs: m.refineInputs
}));
vi.mock('$lib/plan/inputsPlan', () => ({ planInputs: m.planInputs }));
vi.mock('$lib/server/aiSchedule', () => ({
  schedulePlantings: m.schedulePlantings,
  refineSchedule: m.refineSchedule
}));
vi.mock('$lib/server/aiAllocation', () => ({ refineAllocation: m.refineAllocation }));
vi.mock('$lib/server/aiGroupPlanning', () => ({
  proposeGroupPlans: m.proposeGroupPlans,
  proposePlansEngineOnly: m.proposePlansEngineOnly
}));
vi.mock('$lib/server/aiPlanning', () => ({ planWithAI: m.planWithAI }));

import { POST as inputs } from './inputs/+server';
import { POST as inputsRefine } from './inputs/refine/+server';
import { POST as schedule } from './schedule/+server';
import { POST as scheduleRefine } from './schedule/refine/+server';
import { POST as allocateRefine } from './allocate/refine/+server';
import { POST as groups } from './groups/+server';
import { POST as suggest } from './suggest/+server';
import { POST as succession } from './succession/+server';
import { POST as optimize } from './optimize/+server';

const OK = { ok: true, spend: { monthlyUsdSoFar: 0, cap: 5, warnAt80: false } };
const CAP = {
  ok: false,
  reason: 'cap-exceeded',
  status: 402,
  message: 'Monthly AI cap of $5.00 reached.'
};
const QUOTA = {
  ok: false,
  reason: 'quota-exceeded',
  status: 429,
  message: 'Daily quota of 5 reached.'
};

const ZERO_META = {
  model: 'engine',
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  usdEstimate: 0
};

function ev(path: string, body: unknown) {
  return {
    request: new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    locals: {}
  } as never;
}

const PLANTINGS = [
  {
    id: 'p1',
    blockId: 'b1',
    cropPluginId: 'corn',
    varietyDisplayName: 'Golden',
    plantingDate: null
  }
];
const ASSIGNMENTS = [
  {
    stockItemId: 's1',
    blockId: 'b1',
    cropPluginId: 'corn',
    varietyDisplayName: 'Golden',
    plants: 10
  }
];

const schedResult = (extra: Record<string, unknown> = {}) => ({
  scheduled: [{ ...ASSIGNMENTS[0], plantingDateMs: Date.UTC(2027, 4, 1), rationale: '' }],
  rationale: 'r',
  advisories: [],
  windows: [],
  successionFits: [],
  meta: { ...ZERO_META, fallback: 'no-api-key' },
  ...extra
});

type Case = {
  reason: 'no-key' | 'over-cap' | 'rate-limit';
  key: string;
  guard: typeof OK | typeof CAP | typeof QUOTA;
};
const CASES: Case[] = [
  { reason: 'no-key', key: '', guard: OK },
  { reason: 'over-cap', key: 'sk-test', guard: CAP },
  { reason: 'rate-limit', key: 'sk-test', guard: QUOTA }
];

function expectFallbackLogged(endpoint: string, reason: string) {
  expect(m.recordCall).toHaveBeenCalledWith(
    expect.objectContaining({
      endpoint,
      provenance: 'fallback',
      fallbackReason: reason,
      inputTokens: 0,
      outputTokens: 0
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getApiKey.mockReturnValue('');
  m.checkGuard.mockReturnValue(OK);
  m.schedulePlantings.mockImplementation(async () => schedResult());
  m.refineSchedule.mockImplementation(async () => ({ ...schedResult(), reply: 'unchanged' }));
  m.refineAllocation.mockImplementation(async () => ({
    reply: 'unchanged',
    assignments: [],
    unplaced: [],
    sufficiency: [],
    rationale: '',
    perRowRationale: {},
    advisories: [],
    pollinationConstraints: [],
    geometryMissingBlockIds: [],
    companionGroups: [],
    meta: { ...ZERO_META }
  }));
  m.proposePlansEngineOnly.mockImplementation((_input: unknown, reason: string) => ({
    proposed: [{ kind: 'singleton' }],
    unscheduled: [],
    meta: { ...ZERO_META, model: 'engine-only', fallback: reason }
  }));
});

describe.each(CASES)('degradation: $reason', ({ reason, key, guard }) => {
  beforeEach(() => {
    m.getApiKey.mockReturnValue(key);
    m.checkGuard.mockReturnValue(guard);
  });

  it('/api/plan/inputs → 200 deterministic plan', async () => {
    const res = await inputs(ev('/api/plan/inputs', { plantings: PLANTINGS, year: 2027 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toEqual({ deterministic: true });
    expect(body.meta).toMatchObject({ provenance: 'fallback', fallbackReason: reason });
    expect(body.meta.fallback).toBe(reason === 'no-key' ? 'no-api-key' : 'quota-exceeded');
    if (reason !== 'no-key') expect(body.meta.fallbackMessage).toBe((guard as typeof CAP).message);
    expect(m.planInputsWithAI).not.toHaveBeenCalled();
    expectFallbackLogged('inputs', reason);
  });

  it('/api/plan/inputs/refine → 200 with the previous plan unchanged', async () => {
    const res = await inputsRefine(
      ev('/api/plan/inputs/refine', {
        plantings: PLANTINGS,
        year: 2027,
        previousPlan: { previous: true },
        message: 'swap it',
        history: []
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan).toEqual({ previous: true });
    expect(body.meta).toMatchObject({ provenance: 'fallback', fallbackReason: reason });
    expect(m.refineInputs).not.toHaveBeenCalled();
    expectFallbackLogged('inputs', reason);
  });

  it('/api/plan/schedule → 200 deterministic schedule', async () => {
    const res = await schedule(ev('/api/plan/schedule', { assignments: ASSIGNMENTS }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scheduled).toHaveLength(1);
    expect(body.meta).toMatchObject({ provenance: 'fallback', fallbackReason: reason });
    expect(m.schedulePlantings).toHaveBeenCalledTimes(1);
    const opts = m.schedulePlantings.mock.calls[0][2];
    expect(opts.degradeMessage).toBe(
      reason === 'no-key' ? undefined : (guard as typeof CAP).message
    );
    expectFallbackLogged('allocate', reason);
  });

  it('/api/plan/schedule/refine → 200 echo of the previous schedule', async () => {
    const res = await scheduleRefine(
      ev('/api/plan/schedule/refine', {
        assignments: ASSIGNMENTS,
        previousScheduled: [{ ...ASSIGNMENTS[0], plantingDateMs: Date.UTC(2027, 4, 1) }],
        transcript: [{ role: 'user', content: 'move corn' }]
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta).toMatchObject({ provenance: 'fallback', fallbackReason: reason });
    expect(m.refineSchedule).toHaveBeenCalledTimes(1);
    const opts = m.refineSchedule.mock.calls[0][2];
    expect(opts.degradeMessage).toBe(
      reason === 'no-key' ? undefined : (guard as typeof CAP).message
    );
    expectFallbackLogged('allocate', reason);
  });

  it('/api/plan/allocate/refine → 200 echo of the previous plan', async () => {
    const res = await allocateRefine(
      ev('/api/plan/allocate/refine', {
        seedSelections: [
          {
            stockItemId: 's1',
            cropPluginId: 'corn',
            varietyDisplayName: 'Golden',
            quantityPlants: 10
          }
        ],
        blockIds: ['b1'],
        previousPlan: { assignments: [{ stockItemId: 's1', blockId: 'b1', plants: 10 }] },
        transcript: [{ role: 'user', content: 'more corn' }]
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta).toMatchObject({ provenance: 'fallback', fallbackReason: reason });
    expect(m.refineAllocation).toHaveBeenCalledTimes(1);
    const opts = m.refineAllocation.mock.calls[0][3];
    expect(opts.degradeMessage).toBe(
      reason === 'no-key' ? undefined : (guard as typeof CAP).message
    );
    expectFallbackLogged('allocate', reason);
  });

  it('/api/plan/groups → 200 engine-only proposals', async () => {
    const res = await groups(ev('/api/plan/groups', {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposed).toHaveLength(1);
    expect(body.meta).toMatchObject({ provenance: 'fallback', fallbackReason: reason });
    expect(body.meta.fallback).toBe(reason === 'no-key' ? 'no-api-key' : 'ai-unavailable');
    expect(m.proposeGroupPlans).not.toHaveBeenCalled();
    expectFallbackLogged('groups', reason);
  });

  it.each([
    ['suggest', () => suggest(ev('/api/plan/suggest', { blockId: 'b1' }))],
    ['succession', () => succession(ev('/api/plan/succession', { afterCropId: 'c1' }))],
    ['optimize', () => optimize(ev('/api/plan/optimize', { cropWishlist: ['corn'] }))]
  ] as const)('/api/plan/%s → 200 empty suggestions', async (endpoint, run) => {
    const res = await run();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      suggestions: [],
      fallback: reason,
      provenance: 'fallback',
      fallbackReason: reason
    });
    expect(typeof body.message).toBe('string');
    expect(m.planWithAI).not.toHaveBeenCalled();
    expectFallbackLogged(endpoint, reason);
  });
});

describe('AI path still runs when key + guard allow', () => {
  beforeEach(() => {
    m.getApiKey.mockReturnValue('sk-test');
    m.checkGuard.mockReturnValue(OK);
  });

  it('/api/plan/suggest returns Claude suggestions tagged ai', async () => {
    m.planWithAI.mockResolvedValue({
      suggestions: [{ blockId: 'b1', cropPluginId: 'corn' }],
      meta: { ...ZERO_META, model: 'claude', inputTokens: 10 }
    });
    const res = await suggest(ev('/api/plan/suggest', { blockId: 'b1' }));
    const body = await res.json();
    expect(body.provenance).toBe('ai');
    expect(body.suggestions).toHaveLength(1);
    expect(m.recordCall).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'suggest', provenance: 'ai', inputTokens: 10 })
    );
  });

  it('upstream failure degrades to 200 rate-limit instead of 502', async () => {
    m.planWithAI.mockRejectedValue(new Error('boom'));
    const res = await suggest(ev('/api/plan/suggest', { blockId: 'b1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ suggestions: [], fallbackReason: 'rate-limit' });
    expect(body.message).toMatch(/boom/);
  });

  it('/api/plan/inputs runs the AI pass and tags provenance ai', async () => {
    m.planInputsWithAI.mockResolvedValue({ plan: { ai: true }, meta: { ...ZERO_META } });
    const res = await inputs(ev('/api/plan/inputs', { plantings: PLANTINGS, year: 2027 }));
    const body = await res.json();
    expect(body.plan).toEqual({ ai: true });
    expect(body.meta.provenance).toBe('ai');
    expect(m.planInputs).not.toHaveBeenCalled();
  });
});
