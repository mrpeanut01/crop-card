import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitSkip } from './client';
import { listPendingForActiveOwner, primeActiveOwnerId } from '$lib/client/syncQueue';
import { db } from '$lib/client/dexie';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';

beforeEach(async () => {
  primeActiveOwnerId('owner_a');
  await db().pendingSprayRecords.clear();
});

const body = {
  equipmentId: 'eq-1',
  scheduledAt: 1_800_000_000_000,
  reason: 'did-not-run' as const
};

describe('waterer skip client', () => {
  it('queues a skip as the irrigation-skip kind when offline', async () => {
    const fetchFn = vi.fn();
    const out = await submitSkip(body, fetchFn as never, () => false);
    expect(out.status).toBe('queued');
    expect(fetchFn).not.toHaveBeenCalled();
    const rows = await listPendingForActiveOwner();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'irrigation-skip', ownerId: 'owner_a', payload: body });
  });

  it('posts online with a client record id and returns the saved skip', async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)[CLIENT_RECORD_HEADER]).toBeTruthy();
      return new Response(JSON.stringify({ skip: { id: 's1' } }), { status: 201 });
    });
    const out = await submitSkip(body, fetchFn as never, () => true);
    expect(out).toEqual({ status: 'saved', body: { skip: { id: 's1' } } });
    expect(fetchFn.mock.calls[0][0]).toBe('/api/irrigation/skips');
  });

  it('shows the server refusal', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ error: 'Nope' }), { status: 400 })
    );
    expect(await submitSkip(body, fetchFn as never, () => true)).toEqual({
      status: 'error',
      message: 'Nope'
    });
  });
});
