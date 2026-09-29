import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueRecord = vi.fn(async () => 'q1');
const scheduleDrain = vi.fn();
vi.mock('$lib/client/syncQueue', () => ({ enqueueRecord, scheduleDrain }));

import { submitFeedUse, submitProduction } from './recordClient';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';

const eggs = {
  subjectType: 'group' as const,
  subjectId: 'g1',
  kind: 'eggs' as const,
  quantity: 12,
  unit: 'eggs' as const,
  use: 'food' as const
};

beforeEach(() => {
  enqueueRecord.mockClear();
});

describe('recordClient', () => {
  it('queues an egg log with the time it was collected when offline', async () => {
    const fetchFn = vi.fn();
    const out = await submitProduction(eggs, fetchFn as never, () => false);
    expect(out).toEqual({ status: 'queued' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(enqueueRecord).toHaveBeenCalledWith(
      'animal-production',
      expect.objectContaining({ use: 'food', occurredAt: expect.any(Number) }),
      expect.any(String)
    );
  });

  it('queues a lost response under the id the online attempt sent', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await submitProduction(eggs, fetchFn as never, () => true);
    const sent = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<
      string,
      string
    >;
    expect(enqueueRecord).toHaveBeenCalledWith(
      'animal-production',
      expect.anything(),
      sent[CLIENT_RECORD_HEADER]
    );
  });

  it('returns a hold stop and never queues it', async () => {
    const stop = {
      code: 'WITHDRAWAL_ACTIVE',
      error: 'On hold until Jun 10.',
      resubmitAs: 'discard',
      overridable: false
    };
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(stop), { status: 422 }));
    const out = await submitProduction(eggs, fetchFn as never, () => true);
    expect(out).toEqual({ status: 'stopped', stop });
    expect(enqueueRecord).not.toHaveBeenCalled();
  });

  it('keeps the stock item on the queued feed row but not in the posted body', async () => {
    const fetchFn = vi.fn(async () => new Response('{"warnings":[]}', { status: 201 }));
    const out = await submitFeedUse('st_1', { lb: 2 }, fetchFn as never, () => true);
    expect(out).toEqual({ status: 'saved', warnings: [] });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/stock/st_1/use');
    expect(JSON.parse(String(init.body)).stockItemId).toBeUndefined();
    await submitFeedUse('st_1', { lb: 2 }, fetchFn as never, () => false);
    expect(enqueueRecord).toHaveBeenCalledWith(
      'feed-use',
      expect.objectContaining({ stockItemId: 'st_1', lb: 2 }),
      expect.any(String)
    );
  });
});
