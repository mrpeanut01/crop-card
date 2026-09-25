/**
 * #298 — /api/scan-label, /api/scan-url and /api/scan-barcode route their
 * Claude calls through aiTry() + aiGuard. Covers the degradation matrix at
 * the HTTP boundary: no-key (keeps the client's recovery string), quota /
 * cap short-circuit (no Claude call), transient failure, timeout, success
 * metering, and the scan-url input errors that never reach Claude.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  requireUser: vi.fn(() => ({ id: 'user-1', role: 'owner' })),
  checkGuard: vi.fn(),
  recordCall: vi.fn(),
  getApiKey: vi.fn(() => ''),
  claudeVisionLookup: vi.fn(),
  claudeUrlLookup: vi.fn(),
  claudeTextLookup: vi.fn(),
  fetchPageContent: vi.fn()
}));

vi.mock('$lib/server/auth', () => ({ requireUser: m.requireUser }));
vi.mock('$lib/server/aiGuard', () => ({ checkGuard: m.checkGuard, recordCall: m.recordCall }));
vi.mock('$lib/server/scanResult', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/scanResult')>();
  return {
    ...actual,
    getApiKey: m.getApiKey,
    claudeVisionLookup: m.claudeVisionLookup,
    claudeUrlLookup: m.claudeUrlLookup,
    claudeTextLookup: m.claudeTextLookup,
    fetchPageContent: m.fetchPageContent,
    matchCropPlugins: vi.fn(async () => [])
  };
});
vi.mock('$lib/db/taxonomy', () => ({
  findTaxonomyTermByName: vi.fn(() => null),
  inventoryDomain: vi.fn(() => 'x')
}));
vi.mock('$lib/db/stock', () => ({
  getStockItemByPluginId: vi.fn(() => null),
  getStockItemByBarcode: vi.fn(() => null)
}));

import { AnthropicOverloadedError } from '$lib/server/scanResult';
import { SafeFetchError } from '$lib/server/safeFetch';
import { runScanAi } from '$lib/server/scanAi';
import { POST as scanLabel } from './+server';
import { POST as scanUrl } from '../scan-url/+server';
import { POST as scanBarcode } from '../scan-barcode/+server';

function event(path: string, body: unknown, locals: Record<string, unknown> = {}) {
  return {
    request: new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    locals
  } as never;
}

const labelEvent = () => event('/api/scan-label', { image: 'aGVsbG8=' });
const urlEvent = (url = 'https://shop.example/p') => event('/api/scan-url', { url });

const OK_GUARD = { ok: true, spend: { monthlyUsdSoFar: 0, cap: 5, warnAt80: false } };
const USAGE = {
  model: 'claude-sonnet-4-6',
  inputTokens: 1000,
  cachedInputTokens: 0,
  outputTokens: 200,
  usdEstimate: 0.006
};
const PAGE = {
  url: 'https://shop.example/p',
  metaTags: {},
  jsonLd: [{ '@type': 'Product' }],
  selects: [],
  tables: [],
  headings: [],
  defList: [],
  bodyText: 'x'.repeat(100)
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getApiKey.mockReturnValue('');
  m.checkGuard.mockReturnValue(OK_GUARD);
  m.fetchPageContent.mockResolvedValue(PAGE);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 404 }))
  );
});

describe('no-key', () => {
  it('scan-label → 503 fallback carrying the recovery string; Claude never called', async () => {
    const res = await scanLabel(labelEvent());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      found: false,
      source: 'none',
      provenance: 'fallback',
      fallbackReason: 'no-key'
    });
    expect(body.message).toMatch(/No Anthropic API key configured/i);
    expect(m.claudeVisionLookup).not.toHaveBeenCalled();
    expect(m.checkGuard).not.toHaveBeenCalled();
  });

  it('scan-url → same fallback, and the page is never fetched', async () => {
    const res = await scanUrl(urlEvent());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.fallbackReason).toBe('no-key');
    expect(body.message).toMatch(/No Anthropic API key configured/i);
    expect(m.fetchPageContent).not.toHaveBeenCalled();
    expect(m.claudeUrlLookup).not.toHaveBeenCalled();
  });

  it('scan-barcode → 200 not-found (barcode is not an AI-gated method)', async () => {
    const res = await scanBarcode(event('/api/scan-barcode', { barcode: '000000000000' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ found: false, fallbackReason: 'no-key', barcode: '000000000000' });
    expect(m.claudeTextLookup).not.toHaveBeenCalled();
  });
});

describe('aiGuard short-circuit', () => {
  beforeEach(() => m.getApiKey.mockReturnValue('sk-test'));

  it('daily quota exhausted → 429 fallback, logged, Claude never called', async () => {
    m.checkGuard.mockReturnValue({
      ok: false,
      reason: 'quota-exceeded',
      status: 429,
      message: 'Daily scan-label quota of 40 reached.'
    });
    const res = await scanLabel(labelEvent());
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toMatchObject({ found: false, fallbackReason: 'rate-limit' });
    expect(body.message).toMatch(/quota of 40 reached.*Manual entry/);
    expect(m.checkGuard).toHaveBeenCalledWith('user-1', 'scan-label', undefined);
    expect(m.claudeVisionLookup).not.toHaveBeenCalled();
    expect(m.recordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'scan-label',
        provenance: 'fallback',
        fallbackReason: 'rate-limit',
        success: false
      })
    );
  });

  it('monthly cap reached → 402 over-cap fallback; scan-url does not fetch the page', async () => {
    m.checkGuard.mockReturnValue({
      ok: false,
      reason: 'cap-exceeded',
      status: 402,
      message: 'Monthly AI cap of $5.00 reached.'
    });
    const res = await scanUrl(urlEvent());
    expect(res.status).toBe(402);
    expect((await res.json()).fallbackReason).toBe('over-cap');
    expect(m.fetchPageContent).not.toHaveBeenCalled();
  });

  it('passes service-account token context through to the guard', async () => {
    m.claudeVisionLookup.mockResolvedValue({ found: false });
    await scanLabel(
      event('/api/scan-label', { image: 'x' }, { tokenId: 'tok-1', isServiceAccountToken: true })
    );
    expect(m.checkGuard).toHaveBeenCalledWith('user-1', 'scan-label', {
      tokenId: 'tok-1',
      isServiceAccount: true
    });
    expect(m.recordCall).toHaveBeenCalledWith(expect.objectContaining({ tokenId: 'tok-1' }));
  });
});

describe('AI path', () => {
  beforeEach(() => m.getApiKey.mockReturnValue('sk-test'));

  it('success → 200 with provenance ai and a metered call-log row', async () => {
    m.claudeVisionLookup.mockImplementation(async (_img, _bc, onUsage) => {
      onUsage(USAGE);
      return { found: true, displayName: 'Roundup', category: 'herbicide' };
    });
    const res = await scanLabel(labelEvent());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      found: true,
      source: 'claude-vision',
      provenance: 'ai',
      displayName: 'Roundup'
    });
    expect(m.recordCall).toHaveBeenCalledTimes(1);
    expect(m.recordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'scan-label',
        provenance: 'ai',
        success: true,
        model: 'claude-sonnet-4-6',
        inputTokens: 1000,
        outputTokens: 200,
        usdEstimate: 0.006
      })
    );
  });

  it('Anthropic overloaded → 503 retryable with the friendly message', async () => {
    m.claudeVisionLookup.mockRejectedValue(new AnthropicOverloadedError());
    const res = await scanLabel(labelEvent());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ retryable: true, fallbackReason: 'rate-limit', found: false });
    expect(body.message).toMatch(/busy/);
    expect(m.recordCall).toHaveBeenCalledWith(
      expect.objectContaining({ provenance: 'fallback', success: false })
    );
  });

  it('other Claude errors → 503 fallback, never a 500', async () => {
    m.claudeVisionLookup.mockRejectedValue(new Error('boom'));
    const res = await scanLabel(labelEvent());
    expect(res.status).toBe(503);
    expect((await res.json()).message).toMatch(/could not read the label.*Manual entry/i);
  });

  it('timeout → 504 fallback; a late completion is still metered as a timeout row', async () => {
    let finish!: (v: unknown) => void;
    m.claudeVisionLookup.mockImplementation(
      (_img, _bc, onUsage) =>
        new Promise((r) => {
          finish = (v) => {
            onUsage(USAGE);
            r(v);
          };
        })
    );
    const outcome = await runScanAi({
      event: labelEvent(),
      endpoint: 'scan-label',
      subject: 'label',
      timeoutMs: 10,
      call: (onUsage) => m.claudeVisionLookup('x', undefined, onUsage)
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.status).toBe(504);
      expect(outcome.body).toMatchObject({ fallbackReason: 'timeout', retryable: true });
    }
    expect(m.recordCall).not.toHaveBeenCalled();
    finish({ found: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(m.recordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        provenance: 'fallback',
        fallbackReason: 'timeout',
        usdEstimate: 0.006
      })
    );
  });

  it('scan-url success reads the page then calls Claude', async () => {
    m.claudeUrlLookup.mockResolvedValue({ found: true, displayName: 'Seed', category: 'seed' });
    const res = await scanUrl(urlEvent());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ source: 'claude-url', provenance: 'ai' });
    expect(m.fetchPageContent).toHaveBeenCalledWith('https://shop.example/p');
    expect(m.claudeUrlLookup).toHaveBeenCalledWith(PAGE, expect.any(Function));
  });
});

describe('scan-url input errors (not AI degradation)', () => {
  beforeEach(() => m.getApiKey.mockReturnValue('sk-test'));

  it('literal private URL → 400 before any fetch', async () => {
    await expect(
      scanUrl(urlEvent('http://169.254.169.254/latest/meta-data/'))
    ).rejects.toMatchObject({ status: 400 });
    expect(m.fetchPageContent).not.toHaveBeenCalled();
  });

  it('blocked redirect / DNS target → 400, no call-log row', async () => {
    m.fetchPageContent.mockRejectedValue(
      new SafeFetchError('blocked-address', 'URL must be a public http(s) address')
    );
    const res = await scanUrl(urlEvent());
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/public/);
    expect(m.claudeUrlLookup).not.toHaveBeenCalled();
    expect(m.recordCall).not.toHaveBeenCalled();
  });

  it('page load failure → 502', async () => {
    m.fetchPageContent.mockRejectedValue(new Error('Could not load page: ECONNRESET'));
    const res = await scanUrl(urlEvent());
    expect(res.status).toBe(502);
    expect(m.recordCall).not.toHaveBeenCalled();
  });

  it('page without product signal → 422', async () => {
    m.fetchPageContent.mockResolvedValue({ ...PAGE, jsonLd: [], bodyText: 'tiny' });
    const res = await scanUrl(urlEvent());
    expect(res.status).toBe(422);
    expect(m.claudeUrlLookup).not.toHaveBeenCalled();
  });
});
