import { describe, expect, it, vi } from 'vitest';
import { CareCloser } from './careClose';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';

const items = [{ taskId: 't1' }, { taskId: 't2' }, { taskId: 't3' }];
const dose = { healthEvent: { kind: 'deworm' } } as never;

function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });
}

function idsSent(fetchFn: ReturnType<typeof vi.fn>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [, init] of fetchFn.mock.calls as [string, RequestInit][]) {
    const body = JSON.parse(String(init.body)) as { taskId: string };
    const id = (init.headers as Record<string, string>)[CLIENT_RECORD_HEADER];
    (out[body.taskId] ??= []).push(id);
  }
  return out;
}

describe('CareCloser', () => {
  it('never re-sends an item that saved when a later one failed, and keeps one id per task', async () => {
    let n = 0;
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const { taskId } = JSON.parse(String(init.body)) as { taskId: string };
      n++;
      if (taskId === 't2' && n === 2) return jsonRes(422, { error: 'Pick a product.' });
      return jsonRes(200, { warnings: [] });
    });
    let seq = 0;
    const closer = new CareCloser({
      fetchFn: fetchFn as never,
      online: () => true,
      newId: () => `id-${++seq}`
    });
    const first = await closer.run(items, 'complete', () => dose);
    expect(first).toMatchObject({ saved: 1, error: 'Pick a product.' });
    expect(closer.has('t1')).toBe(true);
    expect(closer.has('t2')).toBe(false);

    const retry = await closer.run(items, 'complete', () => dose);
    expect(retry).toMatchObject({ saved: 2, error: null });
    const sent = idsSent(fetchFn);
    expect(sent.t1).toHaveLength(1);
    expect(sent.t2).toHaveLength(2);
    expect(sent.t2[0]).toBe(sent.t2[1]);
  });

  it('keeps the server warnings instead of throwing them away', async () => {
    const fetchFn = vi.fn(async () =>
      jsonRes(200, {
        alreadyClosed: true,
        warnings: [
          { code: 'LABEL_USE_OWNER', message: 'Saved as "not sure".' },
          { code: 'TASK_ALREADY_CLOSED', message: 'Already closed.' }
        ]
      })
    );
    const closer = new CareCloser({ fetchFn: fetchFn as never, online: () => true });
    const r = await closer.run(items.slice(0, 2), 'complete', () => dose);
    expect(r.warnings).toEqual(['Saved as "not sure".', 'Already closed.']);
  });

  it('queues under the same id on a deploy handoff instead of showing an error', async () => {
    const fetchFn = vi.fn(async () =>
      jsonRes(
        503,
        { error: 'updating', code: 'SERVER_UPDATING' },
        { 'retry-after': '5', 'x-cropcard-updating': '1' }
      )
    );
    const queue = vi.fn(async () => {});
    const closer = new CareCloser({
      fetchFn: fetchFn as never,
      online: () => true,
      queue,
      newId: () => 'same'
    });
    const r = await closer.run(items.slice(0, 1), 'complete', () => dose);
    expect(r).toMatchObject({ queued: 1, error: null });
    expect(queue).toHaveBeenCalledWith('t1', 'complete', dose, 'same', expect.any(Number));
  });
});
