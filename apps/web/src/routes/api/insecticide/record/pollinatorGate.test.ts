/**
 * #130 — server enforcement of the pollinator-protection gate. The endpoint
 * must refuse (422 POLLINATOR_BLOCK) regardless of UI state, including
 * replays from the offline queue that carry no bloom attestation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getRegistry, getBlock, geometryCentroid, insertInsecticideEvent } = vi.hoisted(() => ({
  getRegistry: vi.fn(),
  getBlock: vi.fn(),
  geometryCentroid: vi.fn(() => null),
  insertInsecticideEvent: vi.fn(() => ({ id: 'evt-1' }))
}));

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
vi.mock('$lib/db/blocks', () => ({ getBlock, geometryCentroid }));
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
    bloomWindow: { continuous: true, daysFromPlantingMin: 30, beeAttractive: true }
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
