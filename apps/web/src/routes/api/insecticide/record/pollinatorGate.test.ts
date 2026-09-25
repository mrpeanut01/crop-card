/**
 * #130 — server enforcement of the pollinator-protection gate. The endpoint
 * must refuse (422 POLLINATOR_BLOCK) regardless of UI state, including
 * replays from the offline queue that carry no bloom attestation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getRegistry, getBlock, listBlocks, geometryCentroid, insertInsecticideEvent } = vi.hoisted(
  () => ({
    getRegistry: vi.fn(),
    getBlock: vi.fn(),
    listBlocks: vi.fn((): unknown[] => []),
    geometryCentroid: vi.fn((g: string): { lat: number; lon: number } | null =>
      g ? (JSON.parse(g) as { lat: number; lon: number }) : null
    ),
    insertInsecticideEvent: vi.fn(() => ({ id: 'evt-1' }))
  })
);

vi.mock('$lib/server/auth', () => ({ currentUser: () => ({ id: 'u1', role: 'owner' }) }));
vi.mock('$lib/server/session', () => ({ canMutate: (r: string) => r !== 'inspector' }));
vi.mock('$lib/server/registry', () => ({ getRegistry }));
vi.mock('$lib/server/sprayers', () => ({ getSprayer: vi.fn(), recordSpray: vi.fn() }));
vi.mock('$lib/server/seasonClose', () => ({ checkSeasonClosed: () => null }));
vi.mock('$lib/db/insecticideEvents', () => ({
  insertInsecticideEvent,
  listInsecticideEvents: vi.fn(() => [])
}));
vi.mock('$lib/db/scoutObservations', () => ({ listScoutObservations: vi.fn(() => []) }));
vi.mock('$lib/db/blocks', () => ({ getBlock, listBlocks, geometryCentroid }));
vi.mock('$lib/schedule/settings', () => ({
  getFarmLatLon: () => ({ lat: 39.1157, lon: -77.5636 })
}));
vi.mock('$lib/db/stock', () => ({
  decrementForUse: vi.fn(),
  getStockItem: vi.fn(),
  getStockItemByPluginId: vi.fn()
}));
vi.mock('$lib/safety/sunTimes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/safety/sunTimes')>();
  return { ...actual, sunTimesFor: vi.fn(actual.sunTimesFor) };
});
vi.mock('$lib/db/users', () => ({ ensureSystemUser: vi.fn(async () => ({ id: 'sys' })) }));

import { POST } from './+server';
import { sunTimesFor } from '$lib/safety/sunTimes';

const NOON_EDT = Date.parse('2026-06-21T16:00:00Z');
const MIDNIGHT_EDT = Date.parse('2026-06-22T04:00:00Z');
const NINE_PM_EDT = Date.parse('2026-06-22T01:00:00Z');
const EIGHT_AM_EDT_DRAIN = Date.parse('2026-06-22T12:00:00Z');

const base = {
  type: 'insecticide',
  reEntryIntervalHours: 12,
  activeIngredients: [{ name: 'x', iracGroup: '4A' }],
  scoutingThresholds: []
};
const PLUGINS: Record<string, unknown> = {
  neonic: {
    ...base,
    pluginId: 'neonic',
    displayName: 'Neonic',
    pollinator: { beeToxicity: 'highly-toxic', bloomRestriction: 'prohibited-during-bloom' }
  },
  pyrethroid: {
    ...base,
    pluginId: 'pyrethroid',
    displayName: 'Pyrethroid',
    pollinator: { beeToxicity: 'highly-toxic', bloomRestriction: 'dusk-to-dawn-only' }
  },
  bt: {
    ...base,
    pluginId: 'bt',
    displayName: 'Bt',
    pollinator: { beeToxicity: 'relatively-nontoxic', bloomRestriction: 'none' }
  },
  squash: {
    pluginId: 'squash',
    type: 'crop',
    displayName: 'Squash',
    bloomWindow: { continuous: true, daysFromPlantingMin: 30, beeAttractive: true }
  },
  wheat: {
    pluginId: 'wheat',
    type: 'crop',
    displayName: 'Wheat',
    bloomWindow: { monthsOfYear: [5, 6], beeAttractive: false }
  }
};

function post(body: Record<string, unknown>) {
  return POST({
    request: new Request('http://localhost/api/insecticide/record', {
      method: 'POST',
      body: JSON.stringify({
        blockId: 'blk-1',
        conditions: { windMph: 3, tempF: 70, rainForecastMmNext24h: 0 },
        ...body
      }),
      headers: { 'content-type': 'application/json' }
    })
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(EIGHT_AM_EDT_DRAIN);
  getRegistry.mockResolvedValue({
    get: (id: string) => (PLUGINS[id] ? { plugin: PLUGINS[id], hash: 'h' } : undefined)
  });
  getBlock.mockReturnValue({ plantings: [] });
  listBlocks.mockReturnValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/insecticide/record — #130 pollinator gate', () => {
  it('422 POLLINATOR_BLOCK for a bloom-prohibited product on an attested in-bloom block', async () => {
    const res = await post({
      productPluginIds: ['neonic'],
      occurredAt: MIDNIGHT_EDT,
      bloomStatus: 'in-bloom'
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('POLLINATOR_BLOCK');
    expect(body.violations[0].code).toBe('POLLINATOR_BLOCK');
    expect(body.checks.find((c: { id: string }) => c.id === 'bloom').status).toBe('block');
    expect(body.ruleVersion).toMatch(/^0\.5\.6/);
    expect(insertInsecticideEvent).not.toHaveBeenCalled();
  });

  it('treats a missing bloom attestation as unknown (offline replay) and blocks', async () => {
    const res = await post({ productPluginIds: ['neonic'], occurredAt: MIDNIGHT_EDT });
    expect(res.status).toBe(422);
    expect((await res.json()).bloomStatus).toBe('unknown');
  });

  it('derives in-bloom from crop-plugin bloom windows when unattested', async () => {
    getBlock.mockReturnValue({
      plantings: [{ cropPluginId: 'squash', plantingDate: NOON_EDT - 60 * 86_400_000 }]
    });
    const res = await post({ productPluginIds: ['pyrethroid'], occurredAt: NOON_EDT });
    expect(res.status).toBe(422);
    expect((await res.json()).bloomStatus).toBe('in-bloom');
  });

  it('blocks a dusk-to-dawn product at local noon and allows it at midnight', async () => {
    const noon = await post({
      productPluginIds: ['pyrethroid'],
      occurredAt: NOON_EDT,
      bloomStatus: 'in-bloom'
    });
    expect(noon.status).toBe(422);
    const midnight = await post({
      productPluginIds: ['pyrethroid'],
      occurredAt: MIDNIGHT_EDT,
      bloomStatus: 'in-bloom'
    });
    expect(midnight.status).toBe(200);
    const body = await midnight.json();
    expect(body.pollinatorWarnings.map((c: { id: string }) => c.id)).toContain('bee-toxicity');
    expect(insertInsecticideEvent).toHaveBeenCalledTimes(1);
  });

  it('a tank mix inherits the strictest label restriction', async () => {
    const res = await post({
      productPluginIds: ['bt', 'neonic'],
      occurredAt: MIDNIGHT_EDT,
      bloomStatus: 'in-bloom'
    });
    expect(res.status).toBe(422);
  });

  it('allows the bloom-prohibited product when the operator attests no bloom', async () => {
    const res = await post({
      productPluginIds: ['neonic'],
      occurredAt: NOON_EDT,
      bloomStatus: 'not-in-bloom'
    });
    expect(res.status).toBe(200);
  });

  it('relatively-nontoxic products record in daylight bloom', async () => {
    const res = await post({
      productPluginIds: ['bt'],
      occurredAt: NOON_EDT,
      bloomStatus: 'in-bloom'
    });
    expect(res.status).toBe(200);
  });

  it('rejects an invalid bloomStatus value', async () => {
    const res = await post({ productPluginIds: ['bt'], bloomStatus: 'maybe' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/insecticide/record — client occurredAt (offline replay)', () => {
  it('accepts a dusk-to-dawn product sprayed at 21:00 and drained at 08:00', async () => {
    const res = await post({
      productPluginIds: ['pyrethroid'],
      occurredAt: NINE_PM_EDT,
      bloomStatus: 'in-bloom'
    });
    expect(res.status).toBe(200);
    expect(insertInsecticideEvent).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: NINE_PM_EDT })
    );
    const body = await res.json();
    expect(body.pollinatorWarnings.map((c: { id: string }) => c.id)).toContain('bee-toxicity');
  });

  it('evaluates sun times for the application date, not the drain date', async () => {
    await post({
      productPluginIds: ['pyrethroid'],
      occurredAt: NINE_PM_EDT,
      bloomStatus: 'in-bloom'
    });
    expect(sunTimesFor).toHaveBeenCalledTimes(1);
    const [, , when] = vi.mocked(sunTimesFor).mock.calls[0];
    expect(when.getTime()).toBe(NINE_PM_EDT);
  });

  it('without occurredAt keeps server-time behaviour (08:00 daylight → blocked)', async () => {
    const res = await post({ productPluginIds: ['pyrethroid'], bloomStatus: 'in-bloom' });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('POLLINATOR_BLOCK');
  });

  it('400 for an occurredAt beyond the 5-minute future skew', async () => {
    const res = await post({
      productPluginIds: ['bt'],
      occurredAt: EIGHT_AM_EDT_DRAIN + 10 * 60_000,
      bloomStatus: 'not-in-bloom'
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.issues[0].path).toBe('occurredAt');
    expect(insertInsecticideEvent).not.toHaveBeenCalled();
  });

  it('tolerates small client clock skew into the future', async () => {
    const res = await post({
      productPluginIds: ['bt'],
      occurredAt: EIGHT_AM_EDT_DRAIN + 2 * 60_000,
      bloomStatus: 'not-in-bloom'
    });
    expect(res.status).toBe(200);
  });

  it('400 for an occurredAt older than 7 days', async () => {
    const res = await post({
      productPluginIds: ['bt'],
      occurredAt: EIGHT_AM_EDT_DRAIN - 8 * 86_400_000,
      bloomStatus: 'not-in-bloom'
    });
    expect(res.status).toBe(400);
    expect(insertInsecticideEvent).not.toHaveBeenCalled();
  });
});

describe('POST /api/insecticide/record — #130 attestation persistence', () => {
  it('persists an operator attestation, the no-foragers flag, and the verdict', async () => {
    const res = await post({
      productPluginIds: ['pyrethroid'],
      occurredAt: MIDNIGHT_EDT,
      bloomStatus: 'in-bloom',
      attestedNoForagers: true
    });
    expect(res.status).toBe(200);
    expect(insertInsecticideEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        bloomStatus: 'in-bloom',
        bloomStatusSource: 'operator',
        attestedNoForagers: true,
        pollinatorVerdict: 'warn'
      })
    );
  });

  it('records source=plugin when bloom is derived from a crop bloom window', async () => {
    getBlock.mockReturnValue({
      plantings: [{ cropPluginId: 'squash', plantingDate: MIDNIGHT_EDT - 60 * 86_400_000 }]
    });
    const res = await post({ productPluginIds: ['bt'], occurredAt: MIDNIGHT_EDT });
    expect(res.status).toBe(200);
    expect(insertInsecticideEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        bloomStatus: 'in-bloom',
        bloomStatusSource: 'plugin',
        attestedNoForagers: undefined,
        pollinatorVerdict: 'pass'
      })
    );
  });

  it('records source=default + unknown when nothing attests bloom', async () => {
    const res = await post({ productPluginIds: ['bt'], occurredAt: MIDNIGHT_EDT });
    expect(res.status).toBe(200);
    expect(insertInsecticideEvent).toHaveBeenCalledWith(
      expect.objectContaining({ bloomStatus: 'unknown', bloomStatusSource: 'default' })
    );
  });

  it('records not-in-bloom with verdict pass for an attested bloom-free block', async () => {
    const res = await post({
      productPluginIds: ['neonic'],
      occurredAt: NOON_EDT,
      bloomStatus: 'not-in-bloom',
      attestedNoForagers: false
    });
    expect(res.status).toBe(200);
    expect(insertInsecticideEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        bloomStatus: 'not-in-bloom',
        bloomStatusSource: 'operator',
        attestedNoForagers: false,
        pollinatorVerdict: 'pass'
      })
    );
  });
});

describe('POST /api/insecticide/record — nearby pollinator-attractive blocks advisory', () => {
  const geo = (lat: number, lon: number) => JSON.stringify({ lat, lon });
  const planted = MIDNIGHT_EDT - 60 * 86_400_000;
  const planting = (cropPluginId: string) => ({
    cropPluginId,
    varietyDisplayName: cropPluginId,
    plantingDate: planted
  });
  function farm() {
    listBlocks.mockReturnValue([
      { id: 'blk-1', name: 'Treated', geometryGeojson: geo(39.1, -77.5), plantings: [] },
      {
        id: 'near',
        name: 'Squash patch',
        geometryGeojson: geo(39.104, -77.5),
        plantings: [planting('squash')]
      },
      {
        id: 'grain',
        name: 'Wheat',
        geometryGeojson: geo(39.101, -77.5),
        plantings: [planting('wheat')]
      },
      {
        id: 'far',
        name: 'Far squash',
        geometryGeojson: geo(39.15, -77.5),
        plantings: [planting('squash')]
      },
      { id: 'nogeo', name: 'Unmapped', geometryGeojson: undefined, plantings: [planting('squash')] }
    ]);
  }

  it('returns a nearby-blocks warning listing in-range attractive blocks for a bee-toxic product', async () => {
    farm();
    const res = await post({
      productPluginIds: ['pyrethroid'],
      occurredAt: MIDNIGHT_EDT,
      bloomStatus: 'in-bloom'
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const nearby = body.pollinatorWarnings.find((c: { id: string }) => c.id === 'nearby-blocks');
    expect(nearby.status).toBe('warn');
    expect(nearby.blocks.map((b: { blockId: string }) => b.blockId)).toEqual(['near']);
    expect(nearby.blocks[0].reason).toBe('in-bloom');
    expect(nearby.blocks[0].distanceFt).toBeGreaterThan(1000);
    expect(nearby.blocks[0].distanceFt).toBeLessThan(2000);
    expect(nearby.unknownDistance.map((b: { blockId: string }) => b.blockId)).toEqual(['nogeo']);
  });

  it('never blocks: a nearby attractive block does not stop a pass-verdict record', async () => {
    farm();
    const res = await post({
      productPluginIds: ['neonic'],
      occurredAt: NOON_EDT,
      bloomStatus: 'not-in-bloom'
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pollinatorWarnings.map((c: { id: string }) => c.id)).toEqual(['nearby-blocks']);
  });

  it('stays silent for a relatively-nontoxic product', async () => {
    farm();
    const res = await post({ productPluginIds: ['bt'], occurredAt: MIDNIGHT_EDT });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pollinatorWarnings.some((c: { id: string }) => c.id === 'nearby-blocks')).toBe(
      false
    );
  });
});
