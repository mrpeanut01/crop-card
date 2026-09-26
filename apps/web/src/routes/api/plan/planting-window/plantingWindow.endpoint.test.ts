import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getApiKey: vi.fn(() => ''),
  checkGuard: vi.fn(),
  recordCall: vi.fn(),
  create: vi.fn()
}));

const CROP = {
  pluginId: 'tomato-brandywine',
  type: 'crop',
  displayName: 'Brandywine Tomato',
  cropFamily: 'solanaceae',
  daysToMaturity: { min: 80, max: 90 }
};

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: m.create };
  }
}));
vi.mock('$lib/server/scanResult', () => ({ getApiKey: m.getApiKey }));
vi.mock('$lib/server/aiGuard', () => ({ checkGuard: m.checkGuard, recordCall: m.recordCall }));
vi.mock('$lib/server/auth', () => ({
  requireOwner: vi.fn(() => ({ id: 'u1', role: 'owner' }))
}));
vi.mock('$lib/db/tenant', () => ({
  currentOwnerId: () => 'owner-a',
  runWithTenant: (_id: string, fn: () => unknown) => fn()
}));
vi.mock('$lib/server/registry', () => ({
  getRegistry: vi.fn(async () => ({
    get: (id: string) => (id === CROP.pluginId ? { plugin: CROP } : undefined)
  }))
}));
vi.mock('$lib/schedule/settings', () => ({
  frostDatesIsoForYear: () => ({ lastSpring: '2027-04-15', firstFall: '2027-10-15' }),
  getFarmLatLon: () => ({ lat: 39.1, lon: -77.6 }),
  hasFarmLatLon: () => true
}));

import { POST } from './+server';
import {
  clearPlantingWindowCache,
  parsePlantingWindowResponse
} from '$lib/server/aiPlantingWindow';

const OK = { ok: true, spend: { monthlyUsdSoFar: 0, cap: 5, warnAt80: false } };
const AI_WINDOW = {
  earliest: '2027-05-01',
  prime: '2027-05-10',
  latest: '2027-06-15',
  note: 'Loudoun soils reach 60°F in early May.'
};

function ev(body: unknown) {
  return {
    request: new Request('http://localhost/api/plan/planting-window', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    locals: {}
  } as never;
}

function aiReply(text: string) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 300, output_tokens: 60 }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearPlantingWindowCache();
  m.getApiKey.mockReturnValue('');
  m.checkGuard.mockReturnValue(OK);
});

describe('POST /api/plan/planting-window', () => {
  it('returns the frost-date window without calling Claude when there is no key', async () => {
    const res = await POST(ev({ cropPluginId: CROP.pluginId, year: 2027 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.provenance).toBe('fallback');
    expect(body.fallbackReason).toBe('no-key');
    expect(body.window).toMatchObject({ earliest: '2027-04-22', prime: '2027-04-29' });
    expect(m.create).not.toHaveBeenCalled();
  });

  it('returns the AI window, records the call, and caches it', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(aiReply(JSON.stringify(AI_WINDOW)));

    const first = await (await POST(ev({ cropPluginId: CROP.pluginId, year: 2027 }))).json();
    expect(first.provenance).toBe('ai');
    expect(first.window).toEqual(AI_WINDOW);
    expect(m.recordCall).toHaveBeenCalledTimes(1);
    expect(m.create.mock.calls[0][0].messages[0].content).toMatch(/39\.10, -77\.60/);

    const second = await (await POST(ev({ cropPluginId: CROP.pluginId, year: 2027 }))).json();
    expect(second.window).toEqual(AI_WINDOW);
    expect(second.cached).toBe(true);
    expect(m.create).toHaveBeenCalledTimes(1);
  });

  it('degrades to the frost-date window when Claude returns an unusable window', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.create.mockResolvedValue(aiReply(JSON.stringify({ ...AI_WINDOW, prime: '2027-04-01' })));
    const body = await (await POST(ev({ cropPluginId: CROP.pluginId, year: 2027 }))).json();
    expect(body.provenance).toBe('fallback');
    expect(body.window.earliest).toBe('2027-04-22');
  });

  it('degrades when the daily quota is spent', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.checkGuard.mockReturnValue({
      ok: false,
      reason: 'quota-exceeded',
      status: 429,
      message: 'Daily quota reached.'
    });
    const body = await (await POST(ev({ cropPluginId: CROP.pluginId, year: 2027 }))).json();
    expect(body.provenance).toBe('fallback');
    expect(m.create).not.toHaveBeenCalled();
  });

  it('404s an unknown crop and 400s a bad body', async () => {
    expect((await POST(ev({ cropPluginId: 'nope', year: 2027 }))).status).toBe(404);
    expect((await POST(ev({ cropPluginId: CROP.pluginId }))).status).toBe(400);
  });
});

describe('parsePlantingWindowResponse', () => {
  it('accepts fenced JSON and trims a long note', () => {
    const long = 'x'.repeat(300);
    const w = parsePlantingWindowResponse(
      '```json\n' + JSON.stringify({ ...AI_WINDOW, note: long }) + '\n```',
      2027
    );
    expect(w.note!.length).toBeLessThanOrEqual(140);
  });

  it('rejects prose and wrong-year dates', () => {
    expect(() => parsePlantingWindowResponse('Plant in May.', 2027)).toThrow();
    expect(() =>
      parsePlantingWindowResponse(JSON.stringify({ ...AI_WINDOW, latest: '2028-06-01' }), 2027)
    ).toThrow();
  });
});
