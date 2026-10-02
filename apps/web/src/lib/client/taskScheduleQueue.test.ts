import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { queueKindLabel, pendingSummary, KIND_LABEL } from '$lib/animals/queueRecovery';
import { db } from './dexie';
import { bodyForRecord, endpointForRecord } from './syncQueue';
import {
  listQueuedSchedules,
  parseQueuedSchedule,
  scheduleSuggestion,
  type ScheduleSuggestionBody
} from './taskScheduleQueue';

const body: ScheduleSuggestionBody = {
  title: 'Side-dress corn',
  body: 'Promoted from seasonal-task suggestion',
  kind: 'primary',
  blockId: 'blk_1',
  cropId: 'crop_1',
  scheduledFor: Date.parse('2026-10-05'),
  pluginTemplateKey: 'derived:seasonal-task:blk_1:1790000000000'
};

function setOwner(id: string) {
  sessionStorage.setItem('cropcard.activeOwnerId', id);
}

beforeEach(async () => {
  await db().pendingSprayRecords.clear();
  sessionStorage.clear();
  setOwner('owner_a');
});

describe('scheduleSuggestion (SO-05)', () => {
  it('posts online with a client record id and queues nothing', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ task: { id: 't1' } }), { status: 201 })
    );
    const out = await scheduleSuggestion(body, { fetchFn: fetchFn as never, online: true });
    expect(out).toEqual({ status: 'saved', alreadyScheduled: false });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/tasks');
    expect(JSON.parse(String(init.body))).toEqual(body);
    expect((init.headers as Record<string, string>)[CLIENT_RECORD_HEADER]).toMatch(
      /^[A-Za-z0-9_-]{8,80}$/
    );
    expect(await db().pendingSprayRecords.count()).toBe(0);
  });

  it('passes the server alreadyScheduled answer through', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ task: { id: 't1' }, alreadyScheduled: true }), {
          status: 200
        })
    );
    const out = await scheduleSuggestion(body, { fetchFn: fetchFn as never, online: true });
    expect(out).toEqual({ status: 'saved', alreadyScheduled: true });
  });

  it('queues the exact body with no signal and never fetches', async () => {
    const fetchFn = vi.fn();
    const out = await scheduleSuggestion(body, { fetchFn: fetchFn as never, online: false });
    expect(out.status).toBe('queued');
    expect(fetchFn).not.toHaveBeenCalled();
    const [row] = await db().pendingSprayRecords.toArray();
    expect(row).toMatchObject({ ownerId: 'owner_a', kind: 'task-schedule', payload: body });
    expect(endpointForRecord(row)).toBe('/api/tasks');
    expect(bodyForRecord(row)).toEqual(body);
  });

  it('a network error queues under the id it already sent', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const out = await scheduleSuggestion(body, { fetchFn: fetchFn as never, online: true });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const sent = (init.headers as Record<string, string>)[CLIENT_RECORD_HEADER];
    expect(out).toEqual({ status: 'queued', rowId: sent });
    const [row] = await db().pendingSprayRecords.toArray();
    expect(row.id).toBe(sent);
  });

  it('a server error or the updating answer queues', async () => {
    const updating = vi.fn(
      async () =>
        new Response('{}', {
          status: 503,
          headers: { 'x-cropcard-updating': '1', 'retry-after': '5' }
        })
    );
    expect(
      (await scheduleSuggestion(body, { fetchFn: updating as never, online: true })).status
    ).toBe('queued');
    await db().pendingSprayRecords.clear();
    const boom = vi.fn(async () => new Response('oops', { status: 500 }));
    expect((await scheduleSuggestion(body, { fetchFn: boom as never, online: true })).status).toBe(
      'queued'
    );
  });

  it('a 4xx is refused with the server message and queues nothing', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ error: 'unknown blockId' }), { status: 400 })
    );
    const out = await scheduleSuggestion(body, { fetchFn: fetchFn as never, online: true });
    expect(out).toEqual({ status: 'refused', error: 'unknown blockId' });
    expect(await db().pendingSprayRecords.count()).toBe(0);
  });
});

describe('the queue per Owner (SO-04, SO-06)', () => {
  it('lists the active Owner rows and refuses a second live row for the same key', async () => {
    const first = await scheduleSuggestion(body, { online: false });
    const second = await scheduleSuggestion(body, { online: false });
    expect(first.status).toBe('queued');
    expect(second).toEqual(first);
    expect(await db().pendingSprayRecords.count()).toBe(1);

    const other = { ...body, pluginTemplateKey: 'derived:planting:blk_2:1', title: 'Plant' };
    await scheduleSuggestion(other, { online: false });
    const rows = await listQueuedSchedules();
    expect(rows.map((r) => r.pluginTemplateKey)).toEqual([
      body.pluginTemplateKey,
      other.pluginTemplateKey
    ]);
    expect(rows[0]).toMatchObject({
      title: body.title,
      scheduledFor: body.scheduledFor,
      blockId: 'blk_1',
      cropId: 'crop_1',
      rejected: false
    });
  });

  it('an online tap with a waiting row for that key returns the row instead of posting', async () => {
    const queued = await scheduleSuggestion(body, { online: false });
    const fetchFn = vi.fn();
    const out = await scheduleSuggestion(body, { fetchFn: fetchFn as never, online: true });
    expect(out).toEqual(queued);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('a rejected row does not block scheduling the suggestion again', async () => {
    const first = await scheduleSuggestion(body, { online: false });
    if (first.status !== 'queued') throw new Error('expected queued');
    await db().pendingSprayRecords.update(first.rowId, { status: 'rejected' });
    const second = await scheduleSuggestion(body, { online: false });
    expect(second.status).toBe('queued');
    expect(second).not.toEqual(first);
    const rows = await listQueuedSchedules();
    expect(rows.map((r) => r.rejected)).toEqual([true, false]);
  });

  it("hides another Owner's rows", async () => {
    await scheduleSuggestion(body, { online: false });
    setOwner('owner_b');
    expect(await listQueuedSchedules()).toEqual([]);
    await scheduleSuggestion(body, { online: false });
    expect(await listQueuedSchedules()).toHaveLength(1);
    expect(await db().pendingSprayRecords.count()).toBe(2);
  });

  it('skips rows of other kinds and malformed payloads', async () => {
    await db().pendingSprayRecords.put({
      id: 'x1',
      ownerId: 'owner_a',
      kind: 'task-schedule',
      occurredAt: 1,
      payload: { title: '' },
      attempts: 0,
      createdAt: 1
    });
    await db().pendingSprayRecords.put({
      id: 'x2',
      ownerId: 'owner_a',
      kind: 'task',
      occurredAt: 1,
      payload: { taskId: 't', action: 'complete' },
      attempts: 0,
      createdAt: 2
    });
    expect(await listQueuedSchedules()).toEqual([]);
    expect(parseQueuedSchedule('r', body, false)?.pluginTemplateKey).toBe(body.pluginTemplateKey);
    expect(parseQueuedSchedule('r', null, false)).toBeNull();
  });
});

describe('the pending list label (SO-03)', () => {
  it('names the kind in English and Spanish and summarises with the title', () => {
    expect(KIND_LABEL['task-schedule']).toBe('Scheduled task');
    expect(queueKindLabel('task-schedule')).toBe('Scheduled task');
    expect(queueKindLabel('task-schedule', 'en')).toBe('Scheduled task');
    expect(queueKindLabel('task-schedule', 'es')).toBe('Tarea programada');
    expect(pendingSummary('task-schedule', body)).toBe('Side-dress corn');
  });
});
