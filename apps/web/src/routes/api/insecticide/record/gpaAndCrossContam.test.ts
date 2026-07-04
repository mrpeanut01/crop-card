/**
 * #319 + #321 — insecticide record endpoint correctness.
 *
 * (#319) The stock decrement must scale by the SPRAYER's stored calibrated
 * GPA, not the plugin default. We assert the calibrated GPA is threaded into
 * `computeRatedDilution`.
 *
 * (#321) The endpoint must (a) run the cross-contamination gate before
 * persisting — blocking a spray whose tank last carried a different
 * chemistry category with no decon since — and (b) update the sprayer's
 * `lastChemistryClass` to `insecticide-load` after a successful record.
 *
 * All module deps are mocked so the test targets the handler's wiring in
 * isolation, with no DB dependency (mirrors deleteForce.test.ts).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const currentUser = vi.fn(() => ({ id: 'u1', role: 'owner' }));
const getRegistry = vi.fn();
const getSprayer = vi.fn();
const recordSpray = vi.fn();
const computeRatedDilution = vi.fn(() => ({
  pluginId: 'insect-1',
  displayName: 'Bug Off',
  productAmount: 4,
  unit: 'fl-oz',
  display: '4 fl-oz',
  acresCovered: 1,
  gpaUsed: 18,
  ratePerAcre: { amount: 4, unit: 'fl-oz' },
  customRateApplied: false
}));
const insertInsecticideEvent = vi.fn(() => ({ id: 'evt-1' }));
const decrementForUse = vi.fn(() => ({ notes: [] }));
const getStockItem = vi.fn(() => undefined);
const getStockItemByPluginId = vi.fn(() => undefined);

vi.mock('$lib/server/auth', () => ({ currentUser }));
vi.mock('$lib/server/session', () => ({ canMutate: (r: string) => r !== 'inspector' }));
vi.mock('$lib/server/registry', () => ({ getRegistry }));
vi.mock('$lib/server/sprayers', () => ({ getSprayer, recordSpray }));
vi.mock('$lib/dilution/calculator', () => ({ computeRatedDilution }));
vi.mock('$lib/db/insecticideEvents', () => ({
  insertInsecticideEvent,
  listInsecticideEvents: vi.fn(() => [])
}));
vi.mock('$lib/db/scoutObservations', () => ({ listScoutObservations: vi.fn(() => []) }));
vi.mock('$lib/db/blocks', () => ({ getBlock: vi.fn(() => ({ plantings: [] })) }));
vi.mock('$lib/db/stock', () => ({
  decrementForUse,
  getStockItem,
  getStockItemByPluginId
}));
vi.mock('$lib/db/users', () => ({ ensureSystemUser: vi.fn(async () => ({ id: 'sys' })) }));

import { POST } from './+server';

const INSECT_PLUGIN = {
  pluginId: 'insect-1',
  type: 'insecticide',
  displayName: 'Bug Off',
  reEntryIntervalHours: 12,
  ratePerAcre: { amount: 4, unit: 'fl-oz' },
  gpaCalibration: 15,
  activeIngredients: [{ name: 'spinosad', iracGroup: '5' }],
  scoutingThresholds: []
};

function makeEvent(body: unknown) {
  return {
    request: new Request('http://localhost/api/insecticide/record', {
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
    get: (id: string) => (id === 'insect-1' ? { plugin: INSECT_PLUGIN, hash: 'h1' } : undefined)
  });
});

const baseBody = {
  blockId: 'blk-1',
  sprayerId: 'spr-1',
  productPluginIds: ['insect-1'],
  conditions: { windMph: 3, tempF: 60, rainForecastMmNext24h: 0 },
  tankSizeGallons: 18
};

describe('#319 — insecticide decrement uses the sprayer calibrated GPA', () => {
  it('threads the sprayer calibratedGpa (18) into computeRatedDilution, not 15', async () => {
    getSprayer.mockReturnValue({
      id: 'spr-1',
      calibratedGpa: 18,
      lastChemistryClass: undefined
    });
    const res = await POST(makeEvent(baseBody));
    expect(res.status).toBe(200);
    expect(computeRatedDilution).toHaveBeenCalledWith(expect.anything(), 18, 18);
  });

  it('falls back to plugin default (undefined GPA arg) on an uncalibrated sprayer', async () => {
    getSprayer.mockReturnValue({
      id: 'spr-1',
      calibratedGpa: null,
      lastChemistryClass: undefined
    });
    const res = await POST(makeEvent(baseBody));
    expect(res.status).toBe(200);
    expect(computeRatedDilution).toHaveBeenCalledWith(expect.anything(), 18, undefined);
  });
});

describe('#321 — insecticide cross-contamination gate + sprayer state', () => {
  it('records insecticide-load on the sprayer after a successful spray', async () => {
    getSprayer.mockReturnValue({
      id: 'spr-1',
      calibratedGpa: 18,
      lastChemistryClass: undefined
    });
    const res = await POST(makeEvent(baseBody));
    expect(res.status).toBe(200);
    expect(recordSpray).toHaveBeenCalledWith('spr-1', 'insecticide-load', expect.any(Number));
  });

  it('blocks (422) and skips persist when the tank last carried a herbicide with no decon', async () => {
    getSprayer.mockReturnValue({
      id: 'spr-1',
      calibratedGpa: 18,
      lastChemistryClass: 'synthetic-auxin',
      lastSprayedAt: 1000
    });
    const res = await POST(makeEvent(baseBody));
    expect(res.status).toBe(422);
    const payload = (await res.json()) as { requiresDecon: boolean };
    expect(payload.requiresDecon).toBe(true);
    expect(insertInsecticideEvent).not.toHaveBeenCalled();
    expect(recordSpray).not.toHaveBeenCalled();
  });

  it('allows the spray when a decon was recorded after the last (different) load', async () => {
    getSprayer.mockReturnValue({
      id: 'spr-1',
      calibratedGpa: 18,
      lastChemistryClass: 'synthetic-auxin',
      lastSprayedAt: 1000,
      lastDeconAt: 2000
    });
    const res = await POST(makeEvent(baseBody));
    expect(res.status).toBe(200);
    expect(recordSpray).toHaveBeenCalledWith('spr-1', 'insecticide-load', expect.any(Number));
  });
});
