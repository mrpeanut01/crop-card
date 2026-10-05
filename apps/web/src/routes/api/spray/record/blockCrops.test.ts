/**
 * FR-03 / NFR-07: the herbicide record and evaluate endpoints judge a spray
 * against the block's plantings on file, not only the crops the client
 * names, and the registry's crop family wins over the client's. The real
 * kernel runs here; the repos, registry and writes are stubbed.
 */

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

const DAY = 86_400_000;
const m = vi.hoisted(() => ({
  plantings: [] as Array<{ cropPluginId: string; plantingDate: number | null; status: string }>,
  insertSprayEvent: vi.fn(() => ({ id: 'evt-1' }))
}));

const FAMILIES: Record<string, string> = {
  'pumpkin-howden': 'cucurbit',
  'bean-provider': 'legume',
  'corn-sweet': 'corn'
};

vi.mock('$lib/server/auth', () => ({ currentUser: () => ({ id: 'u1', role: 'owner' }) }));
vi.mock('$lib/server/session', () => ({ canMutate: () => true }));
vi.mock('$lib/server/registry', () => ({
  getRegistry: async () => ({
    get: (id: string) =>
      id === 'two-four-d'
        ? {
            hash: 'h1',
            plugin: {
              pluginId: 'two-four-d',
              type: 'herbicide',
              displayName: '2,4-D Amine',
              activeIngredients: [{ name: '2,4-D', chemistryClass: 'synthetic-auxin' }],
              labelClaims: [],
              ratePerAcre: { amount: 32, unit: 'fl-oz' }
            }
          }
        : undefined,
    cropFamilyOf: (id: string) => FAMILIES[id],
    cropTraitsOf: () => []
  })
}));
vi.mock('$lib/server/sprayers', () => ({
  getSprayer: () => ({ id: 'spr-1', calibratedGpa: 20 }),
  recordSpray: vi.fn()
}));
vi.mock('$lib/server/seasonClose', () => ({ checkSeasonClosed: () => null }));
vi.mock('$lib/server/foreignRefs', () => ({ rejectForeignRefs: () => null }));
vi.mock('$lib/db/blocks', () => ({
  getBlock: (id: string) => (id === 'blk-1' ? { id, plantings: m.plantings } : undefined)
}));
vi.mock('$lib/db/crops', () => ({ getCrop: () => ({}) }));
vi.mock('$lib/db/sprayEvents', () => ({ insertSprayEvent: m.insertSprayEvent }));
vi.mock('$lib/db/stock', () => ({
  decrementForUse: vi.fn(),
  getStockItem: () => undefined,
  getStockItemByPluginId: () => undefined
}));
vi.mock('$lib/db/users', () => ({ ensureSystemUser: async () => ({ id: 'sys' }) }));

import { POST as RECORD } from './+server';
import { POST as EVALUATE } from '../evaluate/+server';

const PRE_PLANT = { primary: { cropPluginId: '__pre-plant__' }, coPlanted: [] };

function body(blockCrops: unknown) {
  return {
    blockId: 'blk-1',
    blockCrops,
    productPluginIds: ['two-four-d'],
    sprayer: { id: 'spr-1' },
    conditions: { windMph: 3, tempF: 65, rainForecastMmNext24h: 0 }
  };
}

function call(handler: typeof RECORD, payload: unknown) {
  return handler({
    request: new Request('http://localhost/api/spray/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }),
    url: new URL('http://localhost/api/spray/x')
  } as never) as Promise<Response>;
}

beforeEach(() => {
  m.plantings = [];
  m.insertSprayEvent.mockClear();
});

describe('POST /api/spray/record against the block on file', () => {
  it('refuses 2,4-D on a block with pumpkins in the ground, whatever the client sends', async () => {
    m.plantings = [
      { cropPluginId: 'pumpkin-howden', plantingDate: Date.now() - 20 * DAY, status: 'active' }
    ];
    const res = await call(RECORD, body(PRE_PLANT));
    expect(res.status).toBe(422);
    const out = await res.json();
    expect(out.violations.map((v: { code: string }) => v.code)).toContain('CROP_INCOMPATIBLE');
    expect(m.insertSprayEvent).not.toHaveBeenCalled();
  });

  it('uses the registry family over the one the client sends', async () => {
    const res = await call(
      RECORD,
      body({ primary: { cropPluginId: 'bean-provider', cropFamily: 'corn' } })
    );
    expect(res.status).toBe(422);
    expect(m.insertSprayEvent).not.toHaveBeenCalled();
  });

  it('keeps the pre-plant burndown when the block holds only plans', async () => {
    m.plantings = [
      { cropPluginId: 'pumpkin-howden', plantingDate: Date.now() + 20 * DAY, status: 'active' },
      { cropPluginId: 'bean-provider', plantingDate: null, status: 'planned' },
      { cropPluginId: 'bean-provider', plantingDate: Date.now() - 200 * DAY, status: 'harvested' }
    ];
    const res = await call(RECORD, body(PRE_PLANT));
    expect(res.status).toBe(200);
    expect(m.insertSprayEvent).toHaveBeenCalledOnce();
  });

  it('carries the measured height to the corn on file for the stage gate', async () => {
    m.plantings = [
      { cropPluginId: 'corn-sweet', plantingDate: Date.now() - 40 * DAY, status: 'active' }
    ];
    const res = await call(
      RECORD,
      body({ primary: { cropPluginId: 'corn-sweet', cropFamily: 'corn', heightInches: 14 } })
    );
    expect(res.status).toBe(422);
    const out = await res.json();
    expect(out.violations.map((v: { code: string }) => v.code)).toContain('CROP_STAGE_BLOCK');
  });
});

describe('POST /api/spray/evaluate with a blockId', () => {
  it('stops 2,4-D on the pumpkin block even with a pre-plant body', async () => {
    m.plantings = [
      { cropPluginId: 'pumpkin-howden', plantingDate: Date.now() - 20 * DAY, status: 'active' }
    ];
    const res = await call(EVALUATE, body(PRE_PLANT));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.ok).toBe(false);
  });

  it('404s a block that is not on this farm', async () => {
    const res = await call(EVALUATE, { ...body(PRE_PLANT), blockId: 'other' });
    expect(res.status).toBe(404);
  });
});
