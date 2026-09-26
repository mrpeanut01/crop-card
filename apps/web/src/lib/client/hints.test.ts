/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  claimHint,
  hasSeenHint,
  hintState,
  initHints,
  markHintSeen,
  releaseHint,
  resetHintsForTest
} from './hints';

type Call = { url: string; init?: RequestInit };

function fakeFetch(opts: { serverSeen?: string[]; offline?: boolean } = {}) {
  const calls: Call[] = [];
  const server = new Set(opts.serverSeen ?? []);
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (opts.offline) throw new TypeError('Failed to fetch');
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { keys: string[] };
      for (const k of body.keys) server.add(k);
    }
    return new Response(JSON.stringify({ hints: [...server].map((key) => ({ key, seenAt: 1 })) }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  });
  return { fn: fn as unknown as typeof fetch, calls, server };
}

beforeEach(() => {
  localStorage.clear();
  resetHintsForTest();
});
afterEach(() => resetHintsForTest());

describe('hints', () => {
  it('merges the server list and becomes ready', async () => {
    const f = fakeFetch({ serverSeen: ['map_add'] });
    await initHints('u1', f.fn);
    expect(get(hintState).ready).toBe(true);
    expect(hasSeenHint('map_add')).toBe(true);
    expect(hasSeenHint('plan_first_crop')).toBe(false);
  });

  it('marks seen optimistically and posts to the server', async () => {
    const f = fakeFetch();
    await initHints('u1', f.fn);
    await markHintSeen('plan_first_crop', f.fn);
    expect(hasSeenHint('plan_first_crop')).toBe(true);
    expect(f.server.has('plan_first_crop')).toBe(true);
    expect(JSON.parse(localStorage.getItem('cropcard.hints.pending.u1') ?? '[]')).toEqual([]);
  });

  it('keeps an offline dismissal queued and flushes it on the next load', async () => {
    const offline = fakeFetch({ offline: true });
    await initHints('u1', offline.fn);
    expect(get(hintState).ready).toBe(true);
    await markHintSeen('cards_offline', offline.fn);
    expect(hasSeenHint('cards_offline')).toBe(true);
    expect(JSON.parse(localStorage.getItem('cropcard.hints.pending.u1') ?? '[]')).toEqual([
      'cards_offline'
    ]);

    resetHintsForTest();
    const online = fakeFetch();
    await initHints('u1', online.fn);
    expect(online.server.has('cards_offline')).toBe(true);
    expect(hasSeenHint('cards_offline')).toBe(true);
    expect(JSON.parse(localStorage.getItem('cropcard.hints.pending.u1') ?? '[]')).toEqual([]);
  });

  it('keeps seen state per user', async () => {
    const f = fakeFetch();
    await initHints('u1', f.fn);
    await markHintSeen('map_add', f.fn);
    resetHintsForTest();
    await initHints('u2', fakeFetch().fn);
    expect(hasSeenHint('map_add')).toBe(false);
  });

  it('allows one hint on screen at a time', async () => {
    await initHints('u1', fakeFetch().fn);
    expect(claimHint('map_add')).toBe(true);
    expect(claimHint('map_add')).toBe(true);
    expect(claimHint('map_filter')).toBe(false);
    releaseHint('map_add');
    expect(claimHint('map_filter')).toBe(true);
  });

  it('never claims before the server list has loaded, or once seen', async () => {
    expect(claimHint('map_add')).toBe(false);
    await initHints('u1', fakeFetch({ serverSeen: ['map_add'] }).fn);
    expect(claimHint('map_add')).toBe(false);
  });

  it('frees the slot when the active hint is dismissed', async () => {
    const f = fakeFetch();
    await initHints('u1', f.fn);
    claimHint('map_add');
    await markHintSeen('map_add', f.fn);
    expect(get(hintState).active).toBeNull();
    expect(claimHint('map_filter')).toBe(true);
  });
});
