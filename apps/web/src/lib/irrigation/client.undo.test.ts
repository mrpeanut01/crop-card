import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { undoSkip } from './client';
import { listPendingForActiveOwner, primeActiveOwnerId } from '$lib/client/syncQueue';
import { db } from '$lib/client/dexie';
import { SKIP_UNDO_WINDOW_MS, skipUndoVerdict } from './skipUndo';

// #870 (FU870-2): undoing a skip is online only and never queued.

beforeEach(async () => {
  primeActiveOwnerId('owner_a');
  await db().pendingSprayRecords.clear();
});

describe('undo a waterer skip', () => {
  it('says offline and queues nothing when there is no signal', async () => {
    const fetchFn = vi.fn();
    expect(await undoSkip('s1', fetchFn as never, () => false)).toEqual({ status: 'offline' });
    const throwing = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await undoSkip('s1', throwing as never, () => true)).toEqual({ status: 'offline' });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await listPendingForActiveOwner()).toEqual([]);
  });

  it('sends a DELETE for the skip and passes the server message through', async () => {
    const ok = vi.fn(async (_url: string, _init: RequestInit) => new Response('{"ok":true}'));
    expect(await undoSkip('s 1', ok as never, () => true)).toEqual({ status: 'undone' });
    expect(ok.mock.calls[0][0]).toBe('/api/irrigation/skips/s%201');
    expect(ok.mock.calls[0][1].method).toBe('DELETE');
    const refused = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'NOT_YOURS', message: 'Ask the owner.' }), {
          status: 403
        })
    );
    expect(await undoSkip('s1', refused as never, () => true)).toEqual({
      status: 'error',
      message: 'Ask the owner.'
    });
    const bare = vi.fn(async () => new Response('', { status: 500 }));
    expect(await undoSkip('s1', bare as never, () => true)).toEqual({
      status: 'error',
      message: null
    });
  });
});

describe('skipUndoVerdict', () => {
  const now = 1_800_000_000_000;
  const skip = (createdBy: string | null, ageMs: number) => ({ createdBy, createdAt: now - ageMs });

  it.each([
    ['owner, any skip, any age', skip('someone', 30 * SKIP_UNDO_WINDOW_MS), 'u1', 'owner', 'ok'],
    ['owner, no author', skip(null, 0), 'u1', 'owner', 'ok'],
    ['helper, own, inside 48 h', skip('u1', SKIP_UNDO_WINDOW_MS), 'u1', 'helper', 'ok'],
    ['helper, own, past 48 h', skip('u1', SKIP_UNDO_WINDOW_MS + 1), 'u1', 'helper', 'TOO_LATE'],
    ['helper, another member', skip('u2', 0), 'u1', 'helper', 'NOT_YOURS'],
    ['helper, no author', skip(null, 0), 'u1', 'helper', 'NOT_YOURS'],
    ['inspector, own', skip('u1', 0), 'u1', 'inspector', 'READ_ONLY']
  ] as const)('%s', (_name, s, id, role, verdict) => {
    expect(skipUndoVerdict(s, { id, role }, now)).toBe(verdict);
  });
});
