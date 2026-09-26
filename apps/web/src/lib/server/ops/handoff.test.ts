import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db/client', () => ({ setDbReadOnly: vi.fn(() => 4096) }));

import { setDbReadOnly } from '$lib/db/client';
import { UPDATING_CODE, UPDATING_MESSAGE, isUpdatingResponse } from '$lib/updating';
import { fenceResponse } from './fenceResponse';
import {
  _fenceForTests,
  _resetHandoffForTests,
  handoffStatus,
  isFenced,
  localWalPosition,
  release,
  startHandoffWatcher,
  trackMutation
} from './handoff';

afterEach(() => _resetHandoffForTests());

const req = (method: string, headers: Record<string, string> = {}) =>
  new Request('http://app.test/api/spray/record', { method, headers });

describe('fenceResponse', () => {
  it('lets everything through while serving', () => {
    expect(fenceResponse(req('POST'), false)).toBeNull();
  });

  it('never blocks reads while fenced', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) expect(fenceResponse(req(m), true)).toBeNull();
  });

  it('refuses API writes with 503 + Retry-After and a readable error', async () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = fenceResponse(req(m, { accept: 'application/json' }), true)!;
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('10');
      expect(isUpdatingResponse(res)).toBe(true);
      expect(await res.json()).toEqual({ error: UPDATING_MESSAGE, code: UPDATING_CODE });
    }
  });

  it('answers enhanced form actions with an ActionResult failure the page can show', async () => {
    const res = fenceResponse(req('POST', { 'x-sveltekit-action': 'true' }), true)!;
    const body = await res.json();
    expect(body).toMatchObject({ type: 'failure', status: 503 });
    // devalue's encoding of { error, message, code }
    expect(JSON.parse(body.data)).toEqual([
      { error: 1, message: 1, code: 2 },
      UPDATING_MESSAGE,
      UPDATING_CODE
    ]);
  });

  it('answers plain HTML form posts with a page', async () => {
    const res = fenceResponse(req('POST', { accept: 'text/html,application/xhtml+xml' }), true)!;
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('updating');
  });
});

describe('release', () => {
  it('fences, waits for admitted writes, then makes the connection read-only', async () => {
    let finish!: () => void;
    const slow = trackMutation(() => new Promise<void>((r) => (finish = r)));
    expect(handoffStatus().inflight).toBe(1);

    const done = release('test handoff', 'nonce-b');
    expect(isFenced()).toBe(true);
    expect(fenceResponse(req('POST'), isFenced())?.status).toBe(503);
    await new Promise((r) => setTimeout(r, 150));
    expect(setDbReadOnly).not.toHaveBeenCalled();

    finish();
    await slow;
    await done;
    expect(setDbReadOnly).toHaveBeenCalledTimes(1);
    expect(handoffStatus()).toMatchObject({ phase: 'released', inflight: 0 });
    expect(release('again', null)).toBe(done);
  });

  it('counts in-flight writes even when they throw', async () => {
    await expect(trackMutation(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(handoffStatus().inflight).toBe(0);
  });

  it('_fenceForTests flips the fence without I/O', () => {
    _fenceForTests();
    expect(isFenced()).toBe(true);
  });
});

describe('startHandoffWatcher', () => {
  it('stays off unless HANDOFF_FENCE=1 with storage settings', () => {
    startHandoffWatcher({});
    startHandoffWatcher({ HANDOFF_FENCE: '1', VITEST: 'true' });
    expect(isFenced()).toBe(false);
  });
});

describe('localWalPosition', () => {
  it('mirrors Litestream: highest shadow WAL index, frame-aligned size', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'handoff-'));
    try {
      const db = path.join(dir, 'cropcard.db');
      expect(await localWalPosition(db, 4096)).toBeNull();
      const meta = path.join(dir, '.cropcard.db-litestream');
      const wal = path.join(meta, 'generations', 'abc123', 'wal');
      await mkdir(wal, { recursive: true });
      await writeFile(path.join(meta, 'generation'), 'abc123\n');
      expect(await localWalPosition(db, 4096)).toEqual({
        generation: 'abc123',
        index: 0,
        offset: 0
      });
      await writeFile(path.join(wal, '00000000.wal'), Buffer.alloc(32 + 4120 * 4));
      await writeFile(path.join(wal, '0000000a.wal'), Buffer.alloc(32 + 4120 * 2 + 7));
      expect(await localWalPosition(db, 4096)).toEqual({
        generation: 'abc123',
        index: 10,
        offset: 32 + 4120 * 2
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
