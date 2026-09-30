import { beforeEach, describe, expect, it, vi } from 'vitest';

const queued = vi.hoisted(() => [] as Array<{ kind: string; payload: unknown; id: string }>);
vi.mock('$lib/client/syncQueue', () => ({
  enqueueRecord: async (kind: string, payload: unknown, id: string) => {
    queued.push({ kind, payload, id });
    return id;
  }
}));

import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { submitGermination } from './germinationClient';

beforeEach(() => {
  queued.length = 0;
});

describe('submitGermination', () => {
  it('posts the absolute count with the moment it was seen and a client record id', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 201 }));
    const out = await submitGermination('tray_1', 12, fetchFn as never, () => true, 1000);
    expect(out).toEqual({ status: 'saved', count: 12 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/seed-starts/tray_1/progress');
    expect(JSON.parse(String(init.body))).toEqual({ germinatedCount: 12, observedAt: 1000 });
    expect((init.headers as Record<string, string>)[CLIENT_RECORD_HEADER]).toBeTruthy();
  });

  it('queues as seed-start with no signal or when the request cannot go out', async () => {
    await submitGermination('tray_1', 3, vi.fn() as never, () => false, 5);
    await submitGermination(
      'tray_2',
      4,
      (async () => {
        throw new TypeError('Failed to fetch');
      }) as never,
      () => true,
      6
    );
    expect(queued.map((q) => [q.kind, q.payload])).toEqual([
      ['seed-start', { seedStartId: 'tray_1', germinatedCount: 3, observedAt: 5 }],
      ['seed-start', { seedStartId: 'tray_2', germinatedCount: 4, observedAt: 6 }]
    ]);
  });

  it('shows the server refusal instead of queueing it', async () => {
    const out = await submitGermination(
      'tray_1',
      99,
      (async () =>
        new Response(JSON.stringify({ error: 'That is more than the 72 seeds in this tray.' }), {
          status: 400
        })) as never,
      () => true
    );
    expect(out).toEqual({
      status: 'error',
      message: 'That is more than the 72 seeds in this tray.'
    });
    expect(queued).toEqual([]);
  });
});
