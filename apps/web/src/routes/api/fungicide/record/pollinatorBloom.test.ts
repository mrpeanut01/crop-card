import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/holdGuard', async () => {
  const { writeRecord } = await import('$lib/server/recordWrite');
  const run = (event: { request: Request }, _user: unknown, fn: () => unknown) =>
    writeRecord(event, fn);
  return {
    guardedHoldWrite: async (...a: Parameters<typeof run>) => run(...a),
    tryGuardedHoldWrite: async (...a: Parameters<typeof run>) => ({ ok: true, value: run(...a) })
  };
});

const { getRegistry, getBlock, insertFungicideEvent } = vi.hoisted(() => ({
  getRegistry: vi.fn(),
  getBlock: vi.fn(),
  insertFungicideEvent: vi.fn(() => ({ id: 'evt-1' }))
}));

vi.mock('$lib/server/auth', () => ({ currentUser: () => ({ id: 'u1', role: 'owner' }) }));
vi.mock('$lib/server/session', () => ({ canMutate: (r: string) => r !== 'inspector' }));
vi.mock('$lib/server/registry', () => ({ getRegistry }));
vi.mock('$lib/server/sprayers', () => ({
  getSprayer: () => ({ id: 'spr-1', calibratedGpa: 20, lastChemistryClass: undefined }),
  recordSpray: vi.fn()
}));
vi.mock('$lib/dilution/calculator', () => ({
  computeRatedDilution: () => ({
    pluginId: 'fung-1',
    displayName: 'Bee Hazard',
    productAmount: 6,
    unit: 'fl-oz',
    display: '6 fl-oz',
    acresCovered: 1,
    gpaUsed: 20,
    ratePerAcre: { amount: 6, unit: 'fl-oz' },
    customRateApplied: false
  })
}));
vi.mock('$lib/db/fungicideEvents', () => ({
  insertFungicideEvent,
  listFungicideEvents: vi.fn(() => [])
}));
vi.mock('$lib/db/blocks', () => ({ getBlock }));
vi.mock('$lib/db/stock', () => ({
  decrementForUse: vi.fn(() => ({ notes: [] })),
  getStockItem: vi.fn(() => undefined),
  getStockItemByPluginId: vi.fn(() => undefined)
}));
vi.mock('$lib/db/users', () => ({ ensureSystemUser: vi.fn(async () => ({ id: 'sys' })) }));
vi.mock('$lib/server/recordTaskClose', () => ({ closeTaskForRecord: () => null }));

import { POST } from './+server';

const NOW = Date.now();
const CROP = {
  pluginId: 'squash-bloom',
  type: 'crop',
  bloomWindow: { continuous: true, daysFromPlantingMin: 10 }
};

function fungicide(extra: Record<string, unknown>) {
  return {
    pluginId: 'fung-1',
    type: 'fungicide',
    displayName: 'Bee Hazard',
    reEntryIntervalHours: 4,
    preHarvestIntervalDays: 0,
    ratePerAcre: { amount: 6, unit: 'fl-oz' },
    gpaCalibration: 15,
    activeIngredients: [{ name: 'peroxyacetic acid', fracCode: 'NC' }],
    ...extra
  };
}

function withPlugins(fung: Record<string, unknown>) {
  getRegistry.mockResolvedValue({
    get: (id: string) =>
      id === 'fung-1'
        ? { plugin: fung, hash: 'h1' }
        : id === CROP.pluginId
          ? { plugin: CROP, hash: 'h2' }
          : undefined
  });
}

function post() {
  return POST({
    request: new Request('http://localhost/api/fungicide/record', {
      method: 'POST',
      body: JSON.stringify({
        blockId: 'blk-1',
        sprayerId: 'spr-1',
        productPluginIds: ['fung-1'],
        conditions: { windMph: 3, tempF: 60, rainForecastMmNext24h: 0 },
        tankSizeGallons: 20,
        occurredAt: NOW
      }),
      headers: { 'content-type': 'application/json' }
    })
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  getBlock.mockReturnValue({
    id: 'blk-1',
    plantings: [{ cropPluginId: CROP.pluginId, plantingDate: NOW - 40 * 86_400_000 }]
  });
});

describe('/api/fungicide/record bloom gate reads the label pollinator block', () => {
  it('blocks a low-hint product whose label is highly toxic to bees, in bloom', async () => {
    withPlugins(
      fungicide({
        pollinatorRisk: 'low',
        pollinator: { beeToxicity: 'highly-toxic', bloomRestriction: 'dusk-to-dawn-only' }
      })
    );
    const res = await post();
    expect(res.status).toBe(422);
    const body = (await res.json()) as { violations: { code: string }[]; ruleVersion: string };
    expect(body.violations.map((v) => v.code)).toContain('POLLINATOR_BLOOM_BLOCK');
    expect(insertFungicideEvent).not.toHaveBeenCalled();
  });

  it('a bee-silent label leaves a low hint unblocked', async () => {
    withPlugins(
      fungicide({
        pollinatorRisk: 'low',
        pollinator: { beeToxicity: 'unknown', bloomRestriction: 'none' }
      })
    );
    const res = await post();
    expect(res.status).toBe(200);
  });

  it('a nontoxic label does not clear a high hint', async () => {
    withPlugins(
      fungicide({
        pollinatorRisk: 'high',
        pollinator: { beeToxicity: 'relatively-nontoxic', bloomRestriction: 'none' }
      })
    );
    const res = await post();
    expect(res.status).toBe(422);
  });
});
