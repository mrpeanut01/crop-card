/**
 * Invariant 7 — Plugin Manager AI lookups degrade instead of gating. No
 * key / spent quota / reached cap return 200 (or a 200 SSE stream) with an
 * honest message + `fallbackReason`, never call Claude, and log a
 * zero-token fallback row.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  class AnthropicOverloadedError extends Error {}
  return {
    AnthropicOverloadedError,
    getApiKey: vi.fn(() => ''),
    checkGuard: vi.fn(),
    recordCall: vi.fn(),
    claudeVisionPluginLookup: vi.fn(),
    claudePluginSearchByName: vi.fn(),
    claudePluginSearchByNameStreaming: vi.fn(),
    claudeReceiptScanStreaming: vi.fn(),
    localFuzzyMatchPlugins: vi.fn(async () => [] as Array<{ score: number }>)
  };
});

vi.mock('$lib/server/scanResult', () => ({ getApiKey: m.getApiKey }));
vi.mock('$lib/server/aiGuard', () => ({
  checkGuard: m.checkGuard,
  reserveGuard: m.checkGuard,
  recordCall: m.recordCall
}));
vi.mock('$lib/server/auth', () => ({ requireOwner: vi.fn(() => ({ id: 'u1', role: 'owner' })) }));
vi.mock('$lib/server/aiPluginScan', () => ({
  AnthropicOverloadedError: m.AnthropicOverloadedError,
  claudeVisionPluginLookup: m.claudeVisionPluginLookup,
  claudePluginSearchByName: m.claudePluginSearchByName,
  claudePluginSearchByNameStreaming: m.claudePluginSearchByNameStreaming,
  claudeReceiptScanStreaming: m.claudeReceiptScanStreaming,
  localFuzzyMatchPlugins: m.localFuzzyMatchPlugins
}));

import { POST as scanLabel } from './scan-label/+server';
import { POST as searchByName } from './search-by-name/+server';
import { POST as searchStream } from './search-by-name/stream/+server';
import { POST as scanReceipt } from './scan-receipt/+server';

const OK = { ok: true, spend: { monthlyUsdSoFar: 0, cap: 5, warnAt80: false } };
const CAP = { ok: false, reason: 'cap-exceeded', status: 402, message: 'Monthly AI cap reached.' };
const QUOTA = { ok: false, reason: 'quota-exceeded', status: 429, message: 'Daily quota reached.' };

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

async function frames(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((f) => f.startsWith('data: '))
    .map((f) => JSON.parse(f.slice(6)));
}

const CASES = [
  { reason: 'no-key', key: '', guard: OK },
  { reason: 'over-cap', key: 'sk-test', guard: CAP },
  { reason: 'rate-limit', key: 'sk-test', guard: QUOTA }
] as const;

function expectFallbackLogged(endpoint: string, reason: string) {
  expect(m.recordCall).toHaveBeenCalledWith(
    expect.objectContaining({ endpoint, provenance: 'fallback', fallbackReason: reason })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.localFuzzyMatchPlugins.mockResolvedValue([]);
});

describe.each(CASES)('degradation: $reason', ({ reason, key, guard }) => {
  beforeEach(() => {
    m.getApiKey.mockReturnValue(key);
    m.checkGuard.mockReturnValue(guard);
  });

  it('/api/plugins/scan-label → 200 not-found with an honest message', async () => {
    const res = await scanLabel(ev('/api/plugins/scan-label', { image: 'aGVsbG8=' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ found: false, provenance: 'fallback', fallbackReason: reason });
    expect(body.message).toMatch(/authoring form/);
    if (reason === 'no-key') expect(body.message).toMatch(/No Anthropic API key/);
    else expect(body.message).toContain(guard.ok ? '' : guard.message);
    expect(m.claudeVisionPluginLookup).not.toHaveBeenCalled();
    expectFallbackLogged('plugin-scan', reason);
  });

  it('/api/plugins/search-by-name → 200 with local matches even when there are none', async () => {
    const res = await searchByName(ev('/api/plugins/search-by-name', { query: 'roundup' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      candidates: [],
      source: 'local',
      provenance: 'fallback',
      fallbackReason: reason
    });
    expect(body.meta.aiUnavailable).toBe(true);
    expect(body.meta.quotaBlocked).toBe(!guard.ok);
    expect(typeof body.meta.message).toBe('string');
    expect(m.claudePluginSearchByName).not.toHaveBeenCalled();
    expectFallbackLogged('plugin-search', reason);
  });

  it('/api/plugins/search-by-name/stream → 200 SSE error frame with fallbackReason', async () => {
    const res = await searchStream(ev('/api/plugins/search-by-name/stream', { query: 'roundup' }));
    expect(res.status).toBe(200);
    const out = await frames(res);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      phase: 'error',
      provenance: 'fallback',
      fallbackReason: reason
    });
    expect(m.claudePluginSearchByNameStreaming).not.toHaveBeenCalled();
    expectFallbackLogged('plugin-search', reason);
  });

  it('/api/plugins/scan-receipt → 200 SSE error frame with fallbackReason', async () => {
    const res = await scanReceipt(
      ev('/api/plugins/scan-receipt', { document: 'aGVsbG8=', mediaType: 'image/jpeg' })
    );
    expect(res.status).toBe(200);
    const out = await frames(res);
    expect(out[0]).toMatchObject({ phase: 'error', fallbackReason: reason });
    expect(m.claudeReceiptScanStreaming).not.toHaveBeenCalled();
    expectFallbackLogged('plugin-batch-scan', reason);
  });
});

describe('AI path', () => {
  beforeEach(() => {
    m.getApiKey.mockReturnValue('sk-test');
    m.checkGuard.mockReturnValue(OK);
  });

  it('skipWebSearch never consults the guard', async () => {
    const res = await searchByName(
      ev('/api/plugins/search-by-name', { query: 'roundup', skipWebSearch: true })
    );
    expect(res.status).toBe(200);
    expect(m.checkGuard).not.toHaveBeenCalled();
  });

  it('search-by-name merges Claude candidates and tags provenance ai', async () => {
    m.claudePluginSearchByName.mockResolvedValue({
      candidates: [{ pluginId: 'x' }],
      citations: [],
      meta: {
        model: 'claude',
        inputTokens: 5,
        cachedInputTokens: 0,
        outputTokens: 5,
        usdEstimate: 0
      }
    });
    const res = await searchByName(ev('/api/plugins/search-by-name', { query: 'roundup' }));
    const body = await res.json();
    expect(body).toMatchObject({ source: 'web-search', provenance: 'ai' });
    expect(m.recordCall).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'plugin-search', provenance: 'ai' })
    );
  });

  it('search-by-name upstream overload → 200 local-only with upstreamOverloaded', async () => {
    m.claudePluginSearchByName.mockRejectedValue(new m.AnthropicOverloadedError('overloaded'));
    const res = await searchByName(ev('/api/plugins/search-by-name', { query: 'roundup' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.upstreamOverloaded).toBe(true);
    expect(body.fallbackReason).toBe('rate-limit');
  });

  it('scan-label upstream failure → 200 retryable fallback', async () => {
    m.claudeVisionPluginLookup.mockRejectedValue(new Error('bad image'));
    const res = await scanLabel(ev('/api/plugins/scan-label', { image: 'aGVsbG8=' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ found: false, fallbackReason: 'rate-limit', retryable: true });
    expect(body.message).toMatch(/bad image/);
  });
});
