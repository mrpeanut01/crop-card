import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './dexie';
import { ENDPOINT_BY_KIND, drainQueue } from './syncQueue';
import {
  listQueuedTaskActions,
  parseQueuedTask,
  queueTaskAction,
  queuedActionMap
} from './taskQueue';

const ACTIVE_KEY = 'cropcard.activeOwnerId';

beforeEach(async () => {
  await db().pendingSprayRecords.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseQueuedTask', () => {
  it('accepts a Done or a Skip with a reason', () => {
    expect(parseQueuedTask({ taskId: 't1', action: 'complete', occurredAt: 1 })).toEqual({
      taskId: 't1',
      action: 'complete'
    });
    expect(parseQueuedTask({ taskId: 't1', action: 'abort', reason: 'rain' })).toEqual({
      taskId: 't1',
      action: 'abort',
      reason: 'rain'
    });
  });

  it('rejects anything else', () => {
    for (const bad of [
      null,
      'x',
      {},
      { taskId: '', action: 'complete' },
      { taskId: 't', action: 'edit' }
    ])
      expect(parseQueuedTask(bad)).toBeNull();
  });
});

describe('task actions in the offline queue', () => {
  it('replays through the idempotent close endpoint', () => {
    expect(ENDPOINT_BY_KIND.task).toBe('/api/tasks/close');
  });

  it('lists only the active Owner’s waiting actions', async () => {
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    await queueTaskAction('t_a', 'complete');
    sessionStorage.setItem(ACTIVE_KEY, 'owner_b');
    await queueTaskAction('t_b', 'abort', 'stock out');

    const rows = await listQueuedTaskActions();
    expect(rows.map((r) => [r.taskId, r.action])).toEqual([['t_b', 'abort']]);
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    expect((await listQueuedTaskActions()).map((r) => r.taskId)).toEqual(['t_a']);
  });

  it('stamps when the owner tapped, and drains to the close endpoint', async () => {
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    await queueTaskAction('t_a', 'abort', 'rain');
    const [row] = await db().pendingSprayRecords.toArray();
    expect(row.kind).toBe('task');
    expect(row.payload).toMatchObject({ taskId: 't_a', action: 'abort', reason: 'rain' });
    expect(typeof (row.payload as { occurredAt: number }).occurredAt).toBe('number');

    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes('active-owner') || url.includes('/api/session'))
          return new Response(JSON.stringify({ activeOwnerId: 'owner_a' }), { status: 200 });
        return new Response('{}', { status: 200 });
      })
    );
    const result = await drainQueue();
    expect(result.halted).toBeNull();
    expect(calls).toContain('/api/tasks/close');
    expect(await listQueuedTaskActions()).toEqual([]);
  });

  it('a rejected replay no longer counts as done on the card', () => {
    const map = queuedActionMap([
      { rowId: '1', taskId: 't1', action: 'complete', rejected: true },
      { rowId: '2', taskId: 't2', action: 'abort', rejected: false }
    ]);
    expect([...map]).toEqual([['t2', 'abort']]);
  });
});
