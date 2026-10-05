import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './dexie';
import { ENDPOINT_BY_KIND, drainQueue } from './syncQueue';
import {
  listQueuedTaskActions,
  parseQueuedTask,
  queueTaskAction,
  queuedActionMap,
  sendTaskClose
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

  it('queues a care close under the client id its online try already sent', async () => {
    sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
    const id = await queueTaskAction(
      't_care',
      'complete',
      undefined,
      { healthEvent: { subjectType: 'group', subjectId: 'g1', kind: 'deworm' } },
      'online-try-1234'
    );
    expect(id).toBe('online-try-1234');
    const [row] = await db().pendingSprayRecords.toArray();
    expect(row.id).toBe('online-try-1234');
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

describe('time on Done in the offline queue (F1-13)', () => {
  it('a queued Done carries its minutes once, under the client id the online try used', async () => {
    const fc = (await import('fast-check')).default;
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 720 }),
        fc.stringMatching(/^[A-Za-z0-9_-]{8,40}$/),
        async (minutes, clientId) => {
          await db().pendingSprayRecords.clear();
          sessionStorage.setItem(ACTIVE_KEY, 'owner_a');
          const id = await queueTaskAction('t_time', 'complete', undefined, { minutes }, clientId);
          expect(id).toBe(clientId);
          expect(parseQueuedTask((await db().pendingSprayRecords.get(id))!.payload)).toEqual({
            taskId: 't_time',
            action: 'complete',
            minutes
          });
          const sent: { body: Record<string, unknown>; clientId: string | null }[] = [];
          vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init?: RequestInit) => {
              if (url.includes('active-owner') || url.includes('/api/session'))
                return new Response(JSON.stringify({ activeOwnerId: 'owner_a' }), {
                  status: 200
                });
              const headers = new Headers(init?.headers);
              sent.push({
                body: JSON.parse(String(init?.body)),
                clientId: headers.get('x-cropcard-client-record-id')
              });
              return new Response('{}', { status: 200 });
            })
          );
          await drainQueue();
          await drainQueue();
          expect(sent).toHaveLength(1);
          expect(sent[0].body).toMatchObject({ taskId: 't_time', action: 'complete', minutes });
          expect(sent[0].clientId).toBe(clientId);
          vi.unstubAllGlobals();
        }
      ),
      { numRuns: 20 }
    );
  });
});

describe('sendTaskClose', () => {
  const body = { taskId: 't1', action: 'complete', occurredAt: 1 };

  it('a saved close returns the body and sends the client record id', async () => {
    const fetchFn = vi.fn(async () => new Response('{"alreadyClosed":true}', { status: 200 }));
    expect(await sendTaskClose(body, 'cid_1', fetchFn as never)).toEqual({
      kind: 'saved',
      body: { alreadyClosed: true }
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/tasks/close');
    expect(new Headers(init.headers).get('x-cropcard-client-record-id')).toBe('cid_1');
  });

  it('the deploy fence queues and retries after Retry-After', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('{}', {
          status: 503,
          headers: { 'x-cropcard-updating': '1', 'retry-after': '5' }
        })
    );
    expect(await sendTaskClose(body, 'cid', fetchFn as never)).toEqual({
      kind: 'queue',
      drainInMs: 7000,
      updating: true
    });
  });

  it('any other server error or a lost request queues', async () => {
    const err = vi.fn(async () => new Response('boom', { status: 500 }));
    expect(await sendTaskClose(body, 'cid', err as never)).toEqual({
      kind: 'queue',
      drainInMs: 15_000,
      updating: false
    });
    const lost = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await sendTaskClose(body, 'cid', lost as never)).toEqual({
      kind: 'queue',
      drainInMs: null,
      updating: false
    });
  });

  it('a 4xx is a refusal with the server error', async () => {
    const fetchFn = vi.fn(async () => new Response('{"error":"Nope"}', { status: 403 }));
    expect(await sendTaskClose(body, 'cid', fetchFn as never)).toEqual({
      kind: 'refused',
      status: 403,
      error: 'Nope'
    });
  });
});
