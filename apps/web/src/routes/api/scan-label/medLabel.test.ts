/**
 * Phase 32D (D0-15): the medicine label scan on /api/scan-label goes
 * through aiTry() + aiGuard, returns only the name and NADA number tagged
 * `ai`, and suggests (never sets) a library link on an exact NADA match.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  requireUser: vi.fn(() => ({ id: 'user-1', role: 'owner' })),
  checkGuard: vi.fn(),
  recordCall: vi.fn(),
  getApiKey: vi.fn(() => ''),
  claudeVisionLookup: vi.fn(),
  claudeMedLabelLookup: vi.fn(),
  animalHealthRefs: vi.fn(async () => [
    {
      pluginId: 'test-fixture-dewormer',
      displayName: 'Test fixture dewormer',
      approval: { kind: 'NADA', number: '141-061' }
    }
  ])
}));

vi.mock('$lib/server/auth', () => ({ requireUser: m.requireUser }));
vi.mock('$lib/server/aiGuard', () => ({
  checkGuard: m.checkGuard,
  reserveGuard: m.checkGuard,
  recordCall: m.recordCall
}));
vi.mock('$lib/server/scanResult', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/scanResult')>();
  return {
    ...actual,
    getApiKey: m.getApiKey,
    claudeVisionLookup: m.claudeVisionLookup,
    claudeMedLabelLookup: m.claudeMedLabelLookup,
    matchCropPlugins: vi.fn(async () => [])
  };
});
vi.mock('$lib/server/inventoryLibrary', () => ({ animalHealthRefs: m.animalHealthRefs }));
vi.mock('$lib/db/taxonomy', () => ({
  findTaxonomyTermByName: vi.fn(() => null),
  inventoryDomain: vi.fn(() => 'x')
}));
vi.mock('$lib/db/stock', () => ({
  getStockItemByPluginId: vi.fn(() => null),
  getStockItemByBarcode: vi.fn(() => null)
}));

import { POST as scanLabel } from './+server';

const medEvent = () =>
  ({
    request: new Request('http://localhost/api/scan-label', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: 'aGVsbG8=', target: 'animal-health' })
    }),
    locals: {}
  }) as never;

const OK_GUARD = { ok: true, spend: { monthlyUsdSoFar: 0, cap: 5, warnAt80: false } };

beforeEach(() => {
  vi.clearAllMocks();
  m.getApiKey.mockReturnValue('');
  m.checkGuard.mockReturnValue(OK_GUARD);
});

describe('medicine label scan', () => {
  it('degrades to manual entry with no key and never calls Claude', async () => {
    const res = await scanLabel(medEvent());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ found: false, provenance: 'fallback', fallbackReason: 'no-key' });
    expect(m.claudeMedLabelLookup).not.toHaveBeenCalled();
    expect(m.claudeVisionLookup).not.toHaveBeenCalled();
  });

  it('goes through the guard and refuses on a spent quota', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.checkGuard.mockReturnValue({
      ok: false,
      reason: 'quota-exceeded',
      status: 429,
      message: 'Daily scan-label quota of 40 reached.'
    });
    const res = await scanLabel(medEvent());
    expect(res.status).toBe(429);
    expect(m.checkGuard).toHaveBeenCalledWith('user-1', 'scan-label', undefined);
    expect(m.claudeMedLabelLookup).not.toHaveBeenCalled();
  });

  it('returns the name and NADA only, tagged ai, with an exact-match suggestion', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.claudeMedLabelLookup.mockResolvedValue({
      found: true,
      displayName: 'Example Dewormer',
      nada: { kind: 'NADA', number: '141-061' },
      withdrawal: { meatDays: 7 },
      pluginId: 'test-fixture-dewormer'
    });
    const res = await scanLabel(medEvent());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      found: true,
      source: 'claude-vision',
      displayName: 'Example Dewormer',
      nada: { kind: 'NADA', number: '141-061' },
      suggestedHealthPlugin: {
        pluginId: 'test-fixture-dewormer',
        displayName: 'Test fixture dewormer'
      },
      provenance: 'ai'
    });
    expect(body).not.toHaveProperty('pluginId');
    expect(m.claudeVisionLookup).not.toHaveBeenCalled();
  });

  it('suggests nothing when the number does not match exactly', async () => {
    m.getApiKey.mockReturnValue('sk-test');
    m.claudeMedLabelLookup.mockResolvedValue({
      found: true,
      displayName: 'Other',
      nada: { kind: 'ANADA', number: '141-061' }
    });
    const body = await (await scanLabel(medEvent())).json();
    expect(body.suggestedHealthPlugin).toBeNull();
  });
});
