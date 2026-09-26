/**
 * POST /api/spray/record writes the event, sprayer chemistry history, stock
 * movements and task close in one transaction: a failure after the event
 * row leaves nothing behind. The kernel is stubbed to "ok" here; its own
 * tests cover the verdicts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  insertSprayEvent: vi.fn(),
  recordSpray: vi.fn(),
  decrementForUse: vi.fn(() => ({ notes: [] as string[] })),
  getStockItemByPluginId: vi.fn((): unknown => undefined),
  completeTask: vi.fn()
}));

vi.mock('$lib/server/auth', () => ({ currentUser: () => ({ id: 'u1', role: 'owner' }) }));
vi.mock('$lib/server/session', () => ({ canMutate: () => true }));
vi.mock('$lib/server/registry', () => ({
  getRegistry: async () => ({
    get: (id: string) =>
      id === 'herb-1'
        ? {
            hash: 'h1',
            plugin: {
              pluginId: 'herb-1',
              type: 'herbicide',
              displayName: 'Weed Gone',
              activeIngredients: [{ name: 'x', chemistryClass: 'glyphosate' }],
              labelClaims: [],
              ratePerAcre: { amount: 32, unit: 'fl-oz' }
            }
          }
        : undefined,
    cropFamilyOf: () => 'solanaceae',
    cropTraitsOf: () => []
  })
}));
vi.mock('$lib/server/sprayers', () => ({
  getSprayer: () => ({ id: 'spr-1', calibratedGpa: 20 }),
  recordSpray: m.recordSpray
}));
vi.mock('$lib/server/seasonClose', () => ({ checkSeasonClosed: () => null }));
vi.mock('$lib/server/foreignRefs', () => ({ rejectForeignRefs: () => null }));
vi.mock('$lib/db/blocks', () => ({ getBlock: () => ({}) }));
vi.mock('$lib/db/crops', () => ({ getCrop: () => ({}) }));
vi.mock('$lib/db/sprayEvents', () => ({ insertSprayEvent: m.insertSprayEvent }));
vi.mock('$lib/db/stock', () => ({
  decrementForUse: m.decrementForUse,
  getStockItem: () => undefined,
  getStockItemByPluginId: m.getStockItemByPluginId
}));
vi.mock('$lib/db/tasks', () => ({ completeTask: m.completeTask }));
vi.mock('$lib/db/users', () => ({ ensureSystemUser: async () => ({ id: 'sys' }) }));
vi.mock('$lib/dilution/calculator', () => ({
  computeTankMixDilutions: () => [{ pluginId: 'herb-1', productAmount: 3, unit: 'fl-oz' }]
}));
vi.mock('$lib/safety', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/safety')>()),
  evaluateSpray: () => ({ ok: true, violations: [], warnings: [] })
}));
vi.mock('$lib/safety/userAddedRestrictions', () => ({
  augmentSafetyResult: (r: unknown) => r
}));

import { sqliteHandle } from '$lib/db/client';
import { POST } from './+server';

const body = {
  blockId: 'blk-1',
  taskId: 'task-1',
  blockCrops: { primary: { cropPluginId: 'tomato' } },
  productPluginIds: ['herb-1'],
  sprayer: { id: 'spr-1' },
  conditions: { windMph: 3, tempF: 65, rainForecastMmNext24h: 0 },
  tankSizeGallons: 2
};

function post() {
  return POST({
    request: new Request('http://localhost/api/spray/record', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    url: new URL('http://localhost/api/spray/record')
  } as never);
}

function probe() {
  sqliteHandle().exec('CREATE TABLE IF NOT EXISTS record_write_probe (id TEXT PRIMARY KEY)');
  const id = `spray-${Math.random().toString(36).slice(2)}`;
  return {
    write: () => sqliteHandle().prepare('INSERT INTO record_write_probe (id) VALUES (?)').run(id),
    exists: () => !!sqliteHandle().prepare('SELECT 1 FROM record_write_probe WHERE id = ?').get(id)
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.insertSprayEvent.mockReturnValue({ id: 'evt-1' });
  m.decrementForUse.mockReturnValue({ notes: [] });
});

describe('spray record atomicity', () => {
  it('runs every write inside one transaction', async () => {
    const seen: boolean[] = [];
    const inTx = () => seen.push(sqliteHandle().inTransaction);
    m.insertSprayEvent.mockImplementation(() => (inTx(), { id: 'evt-1' }));
    m.recordSpray.mockImplementation(inTx);
    m.getStockItemByPluginId.mockReturnValue({ id: 'stock-1' });
    m.decrementForUse.mockImplementation(() => (inTx(), { notes: [] }));
    m.completeTask.mockImplementation(inTx);
    const res = await post();
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(4);
    expect(seen.every(Boolean)).toBe(true);
    expect(sqliteHandle().inTransaction).toBe(false);
  });

  it('a sprayer-state failure after the event row rolls the event back', async () => {
    const p = probe();
    m.insertSprayEvent.mockImplementation(() => (p.write(), { id: 'evt-1' }));
    m.recordSpray.mockImplementation(() => {
      throw new Error('sprayer state write failed');
    });
    await expect(post()).rejects.toThrow(/sprayer state/);
    expect(p.exists()).toBe(false);
  });

  it('a task that cannot be closed is a warning; the spray still commits', async () => {
    const p = probe();
    m.insertSprayEvent.mockImplementation(() => (p.write(), { id: 'evt-1' }));
    m.completeTask.mockImplementation(() => {
      throw new Error('task gone');
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect((await res.json()).stockWarnings.join(' ')).toMatch(/task task-1 not closed/);
    expect(p.exists()).toBe(true);
  });
});
