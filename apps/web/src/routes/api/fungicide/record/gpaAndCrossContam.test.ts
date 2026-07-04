/**
 * #319 + #321 — fungicide record endpoint correctness.
 *
 * (#319) The stock decrement must scale by the SPRAYER's stored calibrated
 * GPA, not the plugin default. We assert the calibrated GPA is threaded into
 * `computeRatedDilution`.
 *
 * (#321) The endpoint must (a) run the cross-contamination gate before
 * persisting and (b) update the sprayer's `lastChemistryClass` to
 * `fungicide-load` after a successful record.
 *
 * All module deps are mocked so the test targets the handler's wiring in
 * isolation, with no DB dependency.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const currentUser = vi.fn(() => ({ id: 'u1', role: 'owner' }));
const getRegistry = vi.fn();
const getSprayer = vi.fn();
const recordSpray = vi.fn();
const computeRatedDilution = vi.fn(() => ({
  pluginId: 'fung-1',
  displayName: 'Spot Stop',
  productAmount: 6,
  unit: 'fl-oz',
  display: '6 fl-oz',
  acresCovered: 1,
  gpaUsed: 20,
  ratePerAcre: { amount: 6, unit: 'fl-oz' },
  customRateApplied: false
}));
const insertFungicideEvent = vi.fn(() => ({ id: 'evt-1' }));
const decrementForUse = vi.fn(() => ({ notes: [] }));

vi.mock('$lib/server/auth', () => ({ currentUser }));
vi.mock('$lib/server/session', () => ({ canMutate: (r: string) => r !== 'inspector' }));
vi.mock('$lib/server/registry', () => ({ getRegistry }));
vi.mock('$lib/server/sprayers', () => ({ getSprayer, recordSpray }));
vi.mock('$lib/dilution/calculator', () => ({ computeRatedDilution }));
vi.mock('$lib/db/fungicideEvents', () => ({
  insertFungicideEvent,
  listFungicideEvents: vi.fn(() => [])
}));
vi.mock('$lib/db/blocks', () => ({ getBlock: vi.fn(() => ({ plantings: [] })) }));
vi.mock('$lib/db/stock', () => ({
  decrementForUse,
  getStockItem: vi.fn(() => undefined),
  getStockItemByPluginId: vi.fn(() => undefined)
}));
vi.mock('$lib/db/users', () => ({ ensureSystemUser: vi.fn(async () => ({ id: 'sys' })) }));

import { POST } from './+server';

const FUNG_PLUGIN = {
  pluginId: 'fung-1',
  type: 'fungicide',
  displayName: 'Spot Stop',
  reEntryIntervalHours: 24,
  preHarvestIntervalDays: 14,
  ratePerAcre: { amount: 6, unit: 'fl-oz' },
  gpaCalibration: 15,
  activeIngredients: [{ name: 'azoxystrobin', fracCode: '11' }]
};

function makeEvent(body: unknown) {
  return {
    request: new Request('http://localhost/api/fungicide/record', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' }
    })
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.mockReturnValue({ id: 'u1', role: 'owner' });
  getRegistry.mockResolvedValue({
    get: (id: string) => (id === 'fung-1' ? { plugin: FUNG_PLUGIN, hash: 'h1' } : undefined)
  });
});

const baseBody = {
  blockId: 'blk-1',
  sprayerId: 'spr-1',
  productPluginIds: ['fung-1'],
  conditions: { windMph: 3, tempF: 60, rainForecastMmNext24h: 0 },
  tankSizeGallons: 20
};

describe('#319 — fungicide decrement uses the sprayer calibrated GPA', () => {
  it('threads the sprayer calibratedGpa (20) into computeRatedDilution, not 15', async () => {
    getSprayer.mockReturnValue({ id: 'spr-1', calibratedGpa: 20, lastChemistryClass: undefined });
    const res = await POST(makeEvent(baseBody));
    expect(res.status).toBe(200);
    expect(computeRatedDilution).toHaveBeenCalledWith(expect.anything(), 20, 20);
  });

  it('falls back to plugin default (undefined GPA arg) on an uncalibrated sprayer', async () => {
    getSprayer.mockReturnValue({ id: 'spr-1', calibratedGpa: null, lastChemistryClass: undefined });
    const res = await POST(makeEvent(baseBody));
    expect(res.status).toBe(200);
    expect(computeRatedDilution).toHaveBeenCalledWith(expect.anything(), 20, undefined);
  });
});

describe('#321 — fungicide cross-contamination gate + sprayer state', () => {
  it('records fungicide-load on the sprayer after a successful spray', async () => {
    getSprayer.mockReturnValue({ id: 'spr-1', calibratedGpa: 20, lastChemistryClass: undefined });
    const res = await POST(makeEvent(baseBody));
    expect(res.status).toBe(200);
    expect(recordSpray).toHaveBeenCalledWith('spr-1', 'fungicide-load', expect.any(Number));
  });

  it('blocks (422) and skips persist when the tank last carried a herbicide with no decon', async () => {
    getSprayer.mockReturnValue({
      id: 'spr-1',
      calibratedGpa: 20,
      lastChemistryClass: 'glyphosate',
      lastSprayedAt: 1000
    });
    const res = await POST(makeEvent(baseBody));
    expect(res.status).toBe(422);
    const payload = (await res.json()) as { requiresDecon: boolean };
    expect(payload.requiresDecon).toBe(true);
    expect(insertFungicideEvent).not.toHaveBeenCalled();
    expect(recordSpray).not.toHaveBeenCalled();
  });
});
