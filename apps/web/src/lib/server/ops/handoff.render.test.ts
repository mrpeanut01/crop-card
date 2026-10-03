// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db/client', () => ({ setDbReadOnly: vi.fn(() => 4096) }));

import { setDbReadOnly } from '$lib/db/client';
import {
  ACQUIRE_TIMEOUT_MS,
  CATCHUP_TIMEOUT_MS,
  RENDER_DRAIN_TIMEOUT_MS
} from '../../../../scripts/lib/handoffProtocol.mjs';
import { UPDATING_CODE, UPDATING_MESSAGE } from '$lib/updating';
import { updatingResponse } from './fenceResponse';
import { _resetHandoffForTests, handoffStatus, isFenced, release, trackRender } from './handoff';

afterEach(() => {
  _resetHandoffForTests();
  vi.mocked(setDbReadOnly).mockClear();
});

describe('handoff and export renders (R-12)', () => {
  it('render drain plus catch-up stays under the acquire cap', () => {
    expect(RENDER_DRAIN_TIMEOUT_MS).toBe(30_000);
    expect(RENDER_DRAIN_TIMEOUT_MS + CATCHUP_TIMEOUT_MS).toBeLessThan(ACQUIRE_TIMEOUT_MS);
  });

  it('waits for an accepted render before making the connection read-only', async () => {
    let finish!: () => void;
    const render = trackRender(() => new Promise<void>((r) => (finish = r)));
    expect(handoffStatus().renders).toBe(1);
    const done = release('test handoff', null);
    expect(isFenced()).toBe(true);
    await new Promise((r) => setTimeout(r, 250));
    expect(setDbReadOnly).not.toHaveBeenCalled();
    finish();
    await render;
    await done;
    expect(setDbReadOnly).toHaveBeenCalledTimes(1);
    expect(handoffStatus()).toMatchObject({ phase: 'released', renders: 0 });
  });

  it('counts a render that fails', async () => {
    await expect(trackRender(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(handoffStatus().renders).toBe(0);
  });

  it('gives up waiting after the render drain timeout', async () => {
    vi.useFakeTimers();
    try {
      void trackRender(() => new Promise<void>(() => {}));
      const done = release('test handoff', null);
      await vi.advanceTimersByTimeAsync(RENDER_DRAIN_TIMEOUT_MS - 500);
      expect(setDbReadOnly).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      await done;
      expect(setDbReadOnly).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('updatingResponse', () => {
  it('answers a browser navigation with a page and everything else with JSON', async () => {
    const page = updatingResponse(
      new Request('http://app.test/api/records/export.vdacs.pdf', {
        headers: { accept: 'text/html,application/xhtml+xml' }
      }),
      'es'
    );
    expect(page.status).toBe(503);
    expect(page.headers.get('retry-after')).toBe('10');
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('Volver');

    const api = updatingResponse(new Request('http://app.test/api/account/export.json'), null);
    expect(api.status).toBe(503);
    expect(await api.json()).toEqual({ error: UPDATING_MESSAGE, code: UPDATING_CODE });
  });
});
