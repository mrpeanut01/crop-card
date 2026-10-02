import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { db } from './dexie';
import { saveTaskTime } from './taskTimeClient';

beforeEach(async () => {
  await db().pendingSprayRecords.clear();
  sessionStorage.clear();
  sessionStorage.setItem('cropcard.activeOwnerId', 'owner_a');
});

const input = { startedAt: 1_700_000_000_000, minutes: 30 };

describe('saveTaskTime (D-29)', () => {
  it('posts online with a client record id and returns the entry', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ entry: { id: 'e1', minutes: 30 } }), { status: 201 })
    );
    const out = await saveTaskTime('tk_1', input, fetchFn as never, () => true);
    expect(out).toMatchObject({ status: 'saved', entry: { id: 'e1' } });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/tasks/tk_1/time');
    expect(JSON.parse(String(init.body))).toEqual(input);
    expect((init.headers as Record<string, string>)[CLIENT_RECORD_HEADER]).toBeTruthy();
    expect(await db().pendingSprayRecords.count()).toBe(0);
  });

  it('queues with no signal', async () => {
    const fetchFn = vi.fn();
    const out = await saveTaskTime('tk_1', input, fetchFn as never, () => false);
    expect(out).toEqual({ status: 'queued' });
    expect(fetchFn).not.toHaveBeenCalled();
    const [row] = await db().pendingSprayRecords.toArray();
    expect(row).toMatchObject({
      ownerId: 'owner_a',
      kind: 'time-entry',
      payload: { ...input, taskId: 'tk_1' },
      occurredAt: input.startedAt
    });
  });

  it('a lost request queues under the id it already sent', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const out = await saveTaskTime('tk_1', input, fetchFn as never, () => true);
    expect(out).toEqual({ status: 'queued' });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const sent = (init.headers as Record<string, string>)[CLIENT_RECORD_HEADER];
    const [row] = await db().pendingSprayRecords.toArray();
    expect(row.id).toBe(sent);
  });

  it('a refusal is an error with the server message and queues nothing', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'TIME_OUT_OF_RANGE', message: 'Too old.' }), {
          status: 400
        })
    );
    const out = await saveTaskTime('tk_1', input, fetchFn as never, () => true);
    expect(out).toEqual({ status: 'error', message: 'Too old.' });
    expect(await db().pendingSprayRecords.count()).toBe(0);
  });
});
