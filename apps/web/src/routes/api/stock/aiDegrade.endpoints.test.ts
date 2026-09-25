/**
 * Invariant 7 — stock AI enrichment endpoints degrade instead of gating.
 * No key / spent quota / reached cap → 200 no-op result tagged
 * `provenance: 'fallback'` + `fallbackReason` + an honest message; Claude
 * is never called and nothing is written to the stock row.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getApiKey: vi.fn(() => ''),
  checkGuard: vi.fn(),
  recordCall: vi.fn(),
  generateShortNames: vi.fn(),
  refreshStockItem: vi.fn(),
  updateStockItem: vi.fn(),
  setPendingRefresh: vi.fn(() => ({ pendingRefreshAt: 1 }))
}));

const ITEM = {
  id: 'st1',
  displayName: 'Roundup PowerMAX 3',
  category: 'herbicide',
  pluginId: undefined,
  shortName: undefined,
  typeId: undefined
};

vi.mock('$lib/server/scanResult', () => ({ getApiKey: m.getApiKey }));
vi.mock('$lib/server/aiGuard', () => ({ checkGuard: m.checkGuard, recordCall: m.recordCall }));
vi.mock('$lib/server/auth', () => ({ requireOwner: vi.fn(() => ({ id: 'u1', role: 'owner' })) }));
vi.mock('$lib/server/registry', () => ({
  getRegistry: vi.fn(async () => ({ get: () => undefined, all: () => [] }))
}));
vi.mock('$lib/db/taxonomy', () => ({ getTaxonomyTerm: vi.fn(() => undefined) }));
vi.mock('$lib/db/stock', () => ({
  listStockItems: vi.fn(() => [ITEM]),
  getStockItem: vi.fn(() => ITEM),
  updateStockItem: m.updateStockItem,
  setPendingRefresh: m.setPendingRefresh,
  listItemsWithPendingRefresh: vi.fn(() => [])
}));
vi.mock('$lib/server/aiShortNames', () => ({ generateShortNames: m.generateShortNames }));
vi.mock('$lib/server/aiRefreshStock', () => ({ refreshStockItem: m.refreshStockItem }));

import { POST as shortNames } from './short-names/+server';
import { POST as refreshOne } from './[id]/refresh-ai/+server';
import { POST as refreshBulk } from './refresh-ai/+server';

const OK = { ok: true, spend: { monthlyUsdSoFar: 0, cap: 5, warnAt80: false } };
const CAP = { ok: false, reason: 'cap-exceeded', status: 402, message: 'Monthly AI cap reached.' };
const QUOTA = { ok: false, reason: 'quota-exceeded', status: 429, message: 'Daily quota reached.' };

function ev(path: string, body: unknown, params: Record<string, string> = {}) {
  return {
    request: new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    params,
    locals: {}
  } as never;
}

const CASES = [
  { reason: 'no-key', key: '', guard: OK },
  { reason: 'over-cap', key: 'sk-test', guard: CAP },
  { reason: 'rate-limit', key: 'sk-test', guard: QUOTA }
] as const;

function expectFallbackLogged(reason: string, endpoint: string) {
  expect(m.recordCall).toHaveBeenCalledWith(
    expect.objectContaining({
      endpoint,
      provenance: 'fallback',
      fallbackReason: reason,
      inputTokens: 0
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(CASES)('degradation: $reason', ({ reason, key, guard }) => {
  beforeEach(() => {
    m.getApiKey.mockReturnValue(key);
    m.checkGuard.mockReturnValue(guard);
  });

  it('/api/stock/short-names → 200, nothing renamed', async () => {
    const res = await shortNames(ev('/api/stock/short-names', {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      updated: 0,
      results: [{ itemId: 'st1', shortName: null }],
      provenance: 'fallback',
      fallbackReason: reason
    });
    expect(body.message).toMatch(/full display names/);
    if (reason !== 'no-key') expect(body.message).toContain((guard as typeof CAP).message);
    expect(m.generateShortNames).not.toHaveBeenCalled();
    expect(m.updateStockItem).not.toHaveBeenCalled();
    expectFallbackLogged(reason, 'shortNames');
  });

  it('/api/stock/[id]/refresh-ai → 200, no pending suggestion stored', async () => {
    const res = await refreshOne(ev('/api/stock/st1/refresh-ai', {}, { id: 'st1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ result: null, provenance: 'fallback', fallbackReason: reason });
    expect(body.meta.fallback).toBe(reason === 'no-key' ? 'no-api-key' : 'ai-unavailable');
    expect(body.message).toMatch(/unchanged/);
    expect(m.refreshStockItem).not.toHaveBeenCalled();
    expect(m.setPendingRefresh).not.toHaveBeenCalled();
    expectFallbackLogged(reason, 'rationale');
  });

  it('/api/stock/refresh-ai (bulk) → 200, stops at the first degraded item', async () => {
    const res = await refreshBulk(ev('/api/stock/refresh-ai', {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      processed: 0,
      results: [],
      provenance: 'fallback',
      fallbackReason: reason
    });
    expect(body.message).toMatch(/0 of 1 item\(s\) refreshed/);
    expect(m.refreshStockItem).not.toHaveBeenCalled();
    expect(m.recordCall).toHaveBeenCalledTimes(1);
    expectFallbackLogged(reason, 'rationale');
  });
});

describe('AI path', () => {
  beforeEach(() => {
    m.getApiKey.mockReturnValue('sk-test');
    m.checkGuard.mockReturnValue(OK);
  });

  it('short-names persists Claude names and tags provenance ai', async () => {
    m.generateShortNames.mockResolvedValue({
      results: [{ itemId: 'st1', shortName: 'Roundup' }],
      meta: {
        model: 'haiku',
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 2,
        usdEstimate: 0
      }
    });
    const res = await shortNames(ev('/api/stock/short-names', {}));
    const body = await res.json();
    expect(body).toMatchObject({ updated: 1, provenance: 'ai' });
    expect(m.updateStockItem).toHaveBeenCalledWith('st1', { shortName: 'Roundup' });
  });

  it('refresh-ai upstream throw → 200 rate-limit fallback instead of 500', async () => {
    m.refreshStockItem.mockRejectedValue(new Error('upstream'));
    const res = await refreshOne(ev('/api/stock/st1/refresh-ai', {}, { id: 'st1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ result: null, fallbackReason: 'rate-limit' });
    expect(body.message).toMatch(/upstream/);
  });
});
