import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitGauge, submitWatering } from './client';
import { listPendingForActiveOwner, primeActiveOwnerId } from '$lib/client/syncQueue';
import { db } from '$lib/client/dexie';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';

beforeEach(async () => {
  primeActiveOwnerId('owner_a');
  await db().pendingSprayRecords.clear();
});

describe('watering client', () => {
  it('queues a watering as the irrigation kind when offline, with its time', async () => {
    const fetchFn = vi.fn();
    const out = await submitWatering(
      { fieldId: 'f1', inches: 0.5, occurredAt: 123 },
      fetchFn as never,
      () => false
    );
    expect(out.status).toBe('queued');
    expect(fetchFn).not.toHaveBeenCalled();
    const rows = await listPendingForActiveOwner();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'irrigation', ownerId: 'owner_a', occurredAt: 123 });
  });

  it('queues a gauge reading when the network drops mid-send, reusing the record id', async () => {
    let sentId = '';
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      sentId = (init.headers as Record<string, string>)[CLIENT_RECORD_HEADER];
      throw new TypeError('Failed to fetch');
    });
    const out = await submitGauge(
      { fieldIds: ['f1'], inches: 1.1, readAt: 456 },
      fetchFn as never,
      () => true
    );
    expect(out.status).toBe('queued');
    const rows = await listPendingForActiveOwner();
    expect(rows[0]).toMatchObject({ id: sentId, kind: 'rain-gauge', occurredAt: 456 });
  });

  it('returns the server message on a refusal and saves on success', async () => {
    const refuse = vi.fn(
      async () => new Response(JSON.stringify({ error: 'unknown fieldId' }), { status: 400 })
    );
    expect(await submitWatering({ fieldId: 'x', inches: 1 }, refuse as never, () => true)).toEqual({
      status: 'error',
      message: 'unknown fieldId'
    });
    const ok = vi.fn(
      async () => new Response(JSON.stringify({ irrigation: { id: 'i1' } }), { status: 201 })
    );
    const saved = await submitWatering({ fieldId: 'x', inches: 1 }, ok as never, () => true);
    expect(saved).toEqual({ status: 'saved', body: { irrigation: { id: 'i1' } } });
  });
});
