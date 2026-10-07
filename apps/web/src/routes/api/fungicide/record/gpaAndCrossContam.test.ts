/**
 * #319 + #321 — fungicide record endpoint correctness.
 *
 * (#319) The stock decrement must scale by the SPRAYER's stored calibrated
 * GPA, not the plugin default. We assert the calibrated GPA is threaded into
 * `appliedProductAmount`.
 *
 * (#321) The endpoint must (a) run the cross-contamination gate before
 * persisting and (b) update the sprayer's `lastChemistryClass` to
 * `fungicide-load` after a successful record.
 *
 * All module deps are mocked so the test targets the handler's wiring in
 * isolation, with no DB dependency.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// The C-35 hold guard has its own suites (holdGuard.*.test.ts); this file
// pins the endpoint's other gates, so the guard only runs the write.
vi.mock('$lib/server/holdGuard', async () => {
  const { writeRecord } = await import('$lib/server/recordWrite');
  const run = (event: { request: Request }, _user: unknown, fn: () => unknown) =>
    writeRecord(event, fn);
  return {
    guardedHoldWrite: async (...a: Parameters<typeof run>) => run(...a),
    tryGuardedHoldWrite: async (...a: Parameters<typeof run>) => ({ ok: true, value: run(...a) })
  };
});

const {
  currentUser,
  getRegistry,
  getSprayer,
  recordSpray,
  appliedProductAmount,
  insertFungicideEvent,
  decrementForUse,
  getStockItemByPluginId
} = vi.hoisted(() => ({
  currentUser: vi.fn(() => ({ id: 'u1', role: 'owner' })),
  getRegistry: vi.fn(),
  getSprayer: vi.fn(),
  recordSpray: vi.fn(),
  appliedProductAmount: vi.fn(),
  insertFungicideEvent: vi.fn(() => ({ id: 'evt-1' })),
  decrementForUse: vi.fn(() => ({ notes: [] })),
  getStockItemByPluginId: vi.fn((): unknown => undefined)
}));

vi.mock('$lib/server/auth', () => ({ currentUser }));
vi.mock('$lib/server/session', () => ({ canMutate: (r: string) => r !== 'inspector' }));
vi.mock('$lib/server/registry', () => ({ getRegistry }));
vi.mock('$lib/server/sprayers', () => ({ getSprayer, recordSpray }));
vi.mock('$lib/dilution/calculator', () => ({ appliedProductAmount }));
vi.mock('$lib/db/fungicideEvents', () => ({
  insertFungicideEvent,
  listFungicideEvents: vi.fn(() => [])
}));
vi.mock('$lib/db/blocks', () => ({ getBlock: vi.fn(() => ({ plantings: [] })) }));
vi.mock('$lib/db/stock', () => ({
  decrementForUse,
  getStockItem: vi.fn(() => undefined),
  getStockItemByPluginId
}));
vi.mock('$lib/db/users', () => ({ ensureSystemUser: vi.fn(async () => ({ id: 'sys' })) }));

const closeTaskForRecord = vi.hoisted(() =>
  vi.fn((i: { taskId?: string }) => (i.taskId ? { taskId: i.taskId, status: 'closed' } : null))
);
vi.mock('$lib/server/recordTaskClose', () => ({ closeTaskForRecord }));

import { POST } from './+server';
import { getBlock } from '$lib/db/blocks';

const { appliedProductAmount: realApplied } = await vi.importActual<
  typeof import('$lib/dilution/calculator')
>('$lib/dilution/calculator');
import { sqliteHandle } from '$lib/db/client';

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
  appliedProductAmount.mockImplementation(realApplied);
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
  it('threads the sprayer calibratedGpa (20) into the deduction, not 15', async () => {
    getSprayer.mockReturnValue({ id: 'spr-1', calibratedGpa: 20, lastChemistryClass: undefined });
    const res = await POST(makeEvent(baseBody));
    expect(res.status).toBe(200);
    expect(appliedProductAmount).toHaveBeenCalledWith(expect.anything(), {
      acres: null,
      tankSizeGallons: 20,
      calibratedGpa: 20
    });
  });

  it('falls back to plugin default (undefined GPA arg) on an uncalibrated sprayer', async () => {
    getSprayer.mockReturnValue({ id: 'spr-1', calibratedGpa: null, lastChemistryClass: undefined });
    const res = await POST(makeEvent(baseBody));
    expect(res.status).toBe(200);
    expect(appliedProductAmount).toHaveBeenCalledWith(expect.anything(), {
      acres: null,
      tankSizeGallons: 20,
      calibratedGpa: undefined
    });
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

describe('record writes are one transaction', () => {
  const probe = () => {
    sqliteHandle().exec('CREATE TABLE IF NOT EXISTS record_write_probe (id TEXT PRIMARY KEY)');
    const id = `fung-${Math.random().toString(36).slice(2)}`;
    return {
      id,
      write: () => sqliteHandle().prepare('INSERT INTO record_write_probe (id) VALUES (?)').run(id),
      exists: () =>
        !!sqliteHandle().prepare('SELECT 1 FROM record_write_probe WHERE id = ?').get(id)
    };
  };

  it('a failure after the event row is written rolls the event back', async () => {
    getSprayer.mockReturnValue({ id: 'spr-1', calibratedGpa: 18, lastChemistryClass: undefined });
    const p = probe();
    insertFungicideEvent.mockImplementationOnce(() => {
      p.write();
      return { id: 'evt-1' };
    });
    recordSpray.mockImplementationOnce(() => {
      throw new Error('sprayer state write failed');
    });
    await expect(POST(makeEvent(baseBody))).rejects.toThrow(/sprayer state/);
    expect(p.exists()).toBe(false);
  });

  it('a stock decrement failure stays a warning and the event commits', async () => {
    getSprayer.mockReturnValue({ id: 'spr-1', calibratedGpa: 18, lastChemistryClass: undefined });
    getStockItemByPluginId.mockReturnValueOnce({ id: 'stock-1' } as never);
    const p = probe();
    insertFungicideEvent.mockImplementationOnce(() => {
      p.write();
      return { id: 'evt-1' };
    });
    decrementForUse.mockImplementationOnce(() => {
      throw new Error('lot missing');
    });
    const res = await POST(makeEvent(baseBody));
    expect(res.status).toBe(200);
    expect((await res.json()).stockWarnings.join(' ')).toMatch(/stock decrement failed/);
    expect(p.exists()).toBe(true);
  });
});

describe('Start closes the task in the same transaction (TC-04)', () => {
  it('passes the task, block and event to closeTaskForRecord and answers taskClose', async () => {
    getSprayer.mockReturnValue({ id: 'spr-1', calibratedGpa: 20, lastChemistryClass: undefined });
    const inTx: boolean[] = [];
    closeTaskForRecord.mockImplementationOnce((i: { taskId?: string }) => {
      inTx.push(sqliteHandle().inTransaction);
      return { taskId: i.taskId as string, status: 'closed' };
    });
    const res = await POST(makeEvent({ ...baseBody, taskId: 'task-9' }));
    expect(res.status).toBe(200);
    expect(closeTaskForRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-9',
        record: expect.objectContaining({ blockId: baseBody.blockId }),
        eventTable: 'fungicide_event',
        eventId: 'evt-1'
      })
    );
    expect(inTx).toEqual([true]);
    expect((await res.json()).taskClose).toEqual({ taskId: 'task-9', status: 'closed' });
  });

  it('answers taskClose null without a task id', async () => {
    getSprayer.mockReturnValue({ id: 'spr-1', calibratedGpa: 20, lastChemistryClass: undefined });
    const res = await POST(makeEvent(baseBody));
    expect((await res.json()).taskClose).toBeNull();
  });
});

describe('#762 — the fungicide deduction is rate times the block acres', () => {
  it('takes 6 fl-oz/A over 15 ac, not one tank', async () => {
    getSprayer.mockReturnValue({ id: 'spr-1', calibratedGpa: 20, lastChemistryClass: undefined });
    vi.mocked(getBlock).mockReturnValue({ plantings: [], acres: 15 } as never);
    getStockItemByPluginId.mockReturnValueOnce({ id: 'stock-1' } as never);
    const res = await Promise.resolve(POST(makeEvent(baseBody))).finally(() =>
      vi.mocked(getBlock).mockReturnValue({ plantings: [] } as never)
    );
    expect(res.status).toBe(200);
    expect(decrementForUse).toHaveBeenCalledWith(
      expect.objectContaining({ stockItemId: 'stock-1', amount: 90, unit: 'fl-oz' })
    );
  });
});

describe('#736 — a sprayer is required', () => {
  it('400 without a sprayer, and nothing is written', async () => {
    const { sprayerId: _omit, ...noSprayer } = baseBody;
    const res = await POST(makeEvent(noSprayer));
    expect(res.status).toBe(400);
    expect((await res.json()).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'sprayerId' })])
    );
    expect(insertFungicideEvent).not.toHaveBeenCalled();
  });

  it('404 for a sprayer that is not on the farm', async () => {
    getSprayer.mockReturnValue(undefined);
    const res = await POST(makeEvent(baseBody));
    expect(res.status).toBe(404);
    expect(insertFungicideEvent).not.toHaveBeenCalled();
  });
});
