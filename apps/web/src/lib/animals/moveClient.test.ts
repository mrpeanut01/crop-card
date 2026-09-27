import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueRecord = vi.fn(async () => 'q1');
const scheduleDrain = vi.fn();
vi.mock('$lib/client/syncQueue', () => ({ enqueueRecord, scheduleDrain }));

const { submitMove } = await import('./moveClient');
const { CLIENT_RECORD_HEADER } = await import('$lib/clientRecordHeader');

const input = { subjectType: 'group' as const, subjectId: 'g1', fieldId: 'f1' };

beforeEach(() => {
  enqueueRecord.mockClear();
  scheduleDrain.mockClear();
});

describe('submitMove', () => {
  it('queues the move with its time when the phone is offline', async () => {
    const fetchFn = vi.fn();
    const out = await submitMove(input, fetchFn as never, () => false);
    expect(out).toEqual({ status: 'queued' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(enqueueRecord).toHaveBeenCalledWith(
      'animal-move',
      expect.objectContaining({ subjectId: 'g1', fieldId: 'f1', movedAt: expect.any(Number) }),
      expect.any(String)
    );
  });

  it('queues when the request never reaches the server', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const out = await submitMove({ ...input, movedAt: 1234 }, fetchFn as never, () => true);
    expect(out.status).toBe('queued');
    expect(enqueueRecord).toHaveBeenCalledWith(
      'animal-move',
      expect.objectContaining({ movedAt: 1234 }),
      expect.any(String)
    );
  });

  it('queues a lost response under the id the online attempt sent', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await submitMove(input, fetchFn as never, () => true);
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    const sent = (init.headers as Record<string, string>)[CLIENT_RECORD_HEADER];
    expect(sent).toEqual(expect.any(String));
    expect(enqueueRecord).toHaveBeenCalledWith('animal-move', expect.anything(), sent);
  });

  it('queues and retries later while the server is updating', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'SERVER_UPDATING' }), {
          status: 503,
          headers: { 'retry-after': '5', 'x-cropcard-updating': '1' }
        })
    );
    const out = await submitMove(input, fetchFn as never, () => true);
    expect(out.status).toBe('queued');
    expect(scheduleDrain).toHaveBeenCalled();
  });

  it('returns a refusal in plain words and does not queue it', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'ALREADY_THERE', error: 'x' }), { status: 409 })
    );
    const out = await submitMove(input, fetchFn as never, () => true);
    expect(out).toEqual({ status: 'error', message: 'They are already there.' });
    expect(enqueueRecord).not.toHaveBeenCalled();
  });

  it('returns the saved move', async () => {
    const move = { fieldId: 'f1', newGroup: null, capacity: null };
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ move }), { status: 201 }));
    const out = await submitMove(input, fetchFn as never, () => true);
    expect(out).toEqual({ status: 'saved', move });
    const body = JSON.parse(
      (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
    );
    expect(body.movedAt).toEqual(expect.any(Number));
  });
});
