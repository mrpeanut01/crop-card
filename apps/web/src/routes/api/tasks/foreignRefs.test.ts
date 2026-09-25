/**
 * POST /api/tasks rejects references to rows outside the active Owner
 * (Invariant 6). The tenant-scoped getters return undefined for another
 * Owner's ids, so a foreign blockId / cropId / equipmentId / linkedToTaskId
 * must 400 before any task is written.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const OWN = 'own';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn((input: Record<string, unknown>) => ({ id: 'task-1', ...input })),
  getBlock: vi.fn(),
  getCrop: vi.fn(),
  getEquipment: vi.fn(),
  getTask: vi.fn()
}));

vi.mock('$lib/server/auth', () => ({
  currentUser: () => ({ id: 'user-1', role: 'owner' })
}));
vi.mock('$lib/server/session', () => ({ canMutate: () => true }));
vi.mock('$lib/server/registry', () => ({ getRegistry: async () => ({ get: () => undefined }) }));
vi.mock('$lib/db/users', () => ({ ensureSystemUser: vi.fn() }));
vi.mock('$lib/db/blocks', () => ({ getBlock: mocks.getBlock }));
vi.mock('$lib/db/crops', () => ({ getCrop: mocks.getCrop }));
vi.mock('$lib/db/equipment', () => ({ getEquipment: mocks.getEquipment }));
vi.mock('$lib/db/tasks', () => ({
  createTask: mocks.createTask,
  getTask: mocks.getTask,
  listTasks: vi.fn(() => []),
  loadEquipmentContext: () => ({}),
  materializePluginPrePost: () => ({ preTaskIds: [], postTaskIds: [] })
}));

import { POST } from './+server';

function post(body: Record<string, unknown>) {
  return POST({
    request: new Request('http://localhost/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Scout', kind: 'primary', scheduledFor: 1, ...body })
    })
  } as never);
}

const ownOnly = (id: string) => (id === OWN ? { id } : undefined);

beforeEach(() => {
  mocks.createTask.mockClear();
  for (const g of [mocks.getBlock, mocks.getCrop, mocks.getEquipment, mocks.getTask]) {
    g.mockImplementation(ownOnly);
  }
});

describe('POST /api/tasks foreign references', () => {
  it.each(['blockId', 'cropId', 'equipmentId'])('foreign %s → 400, nothing written', async (k) => {
    const res = await post({ [k]: 'other-owner-id' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: `unknown ${k}` });
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('foreign linkedToTaskId on a pre-task → 400', async () => {
    const res = await post({ kind: 'pre-task', linkedToTaskId: 'other-owner-task' });
    expect(res.status).toBe(400);
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('own references → 201', async () => {
    const res = await post({ blockId: OWN, cropId: OWN, equipmentId: OWN });
    expect(res.status).toBe(201);
    expect(mocks.createTask).toHaveBeenCalledOnce();
  });

  it('no references → 201', async () => {
    const res = await post({});
    expect(res.status).toBe(201);
  });
});
