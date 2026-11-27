/**
 * First-use hints, client side (Phase 30 §5). Seen state is per user: the
 * server copy (`/api/me/hints`) follows the person across devices, and a
 * localStorage copy makes "Got it" stick instantly and offline. Dismissals
 * made offline stay queued in localStorage and are flushed on the next load
 * or when the browser comes back online. Losing one only means a hint shows
 * once more.
 *
 * Usage from any surface:
 *   <Hint key="map_add" anchor="[data-hint-anchor=map_add]" text="…" />
 * or, without the component, `hintVisible(key)` + `markHintSeen(key)`.
 */

import { get, writable, type Readable } from 'svelte/store';
import { hintKeySchema, isTipKey } from '$lib/hints';

interface HintState {
  userId: string | null;
  seen: ReadonlySet<string>;
  /** True once the server list has been merged (or failed to load). */
  ready: boolean;
  /** The one hint allowed on screen right now. */
  active: string | null;
  /** The beginner tip on screen, if any. Anchored hints wait for it. */
  tip: string | null;
}

const EMPTY: HintState = {
  userId: null,
  seen: new Set(),
  ready: false,
  active: null,
  tip: null
};
const store = writable<HintState>(EMPTY);
let loading: Promise<void> | null = null;
let onlineBound = false;

export const hintState: Readable<HintState> = { subscribe: store.subscribe };

type Fetch = typeof fetch;

function lsKey(userId: string, bucket: 'seen' | 'pending'): string {
  return `cropcard.hints.${bucket}.${userId}`;
}

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((k): k is string => hintKeySchema.safeParse(k).success) : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: Iterable<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...new Set(list)]));
  } catch {
    /* storage full or blocked: in-memory state still hides the hint */
  }
}

async function flushPending(userId: string, fetcher: Fetch): Promise<void> {
  const sent = readList(lsKey(userId, 'pending')).slice(0, 50);
  if (sent.length === 0) return;
  try {
    const res = await fetcher('/api/me/hints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys: sent })
    });
    if (res.ok || res.status === 400 || res.status === 409) {
      const left = readList(lsKey(userId, 'pending')).filter((k) => !sent.includes(k));
      writeList(lsKey(userId, 'pending'), left);
    }
  } catch {
    /* offline: try again later */
  }
}

/**
 * Loads seen hints for `userId` once per session: local state first, then
 * the server list merged in. Switching user resets everything.
 */
export function initHints(userId: string | null, fetcher: Fetch = fetch): Promise<void> {
  const cur = get(store);
  if (cur.userId === userId && loading) return loading;
  if (!userId) {
    store.set({ ...EMPTY, ready: true, tip: cur.tip });
    loading = Promise.resolve();
    return loading;
  }
  const local = readList(lsKey(userId, 'seen'));
  const pending = readList(lsKey(userId, 'pending'));
  store.set({
    userId,
    seen: new Set([...local, ...pending]),
    ready: false,
    active: null,
    tip: cur.tip
  });
  if (!onlineBound && typeof window !== 'undefined') {
    onlineBound = true;
    window.addEventListener('online', () => {
      const id = get(store).userId;
      if (id) void flushPending(id, fetch);
    });
  }
  loading = (async () => {
    await flushPending(userId, fetcher);
    try {
      const res = await fetcher('/api/me/hints');
      if (res.ok) {
        const body = (await res.json()) as { hints?: Array<{ key?: unknown }> };
        const server = (body.hints ?? [])
          .map((h) => h.key)
          .filter((k): k is string => typeof k === 'string');
        if (get(store).userId !== userId) return;
        // The server decides which tips are dismissed, so "Show all tips
        // again" on one device reaches the others. A dismissal still
        // waiting to upload is kept.
        const waiting = new Set(readList(lsKey(userId, 'pending')));
        store.update((s) => ({
          ...s,
          seen: new Set([...[...s.seen].filter((k) => !isTipKey(k) || waiting.has(k)), ...server])
        }));
        writeList(lsKey(userId, 'seen'), get(store).seen);
      }
    } catch {
      /* offline: local state decides */
    }
    if (get(store).userId === userId) store.update((s) => ({ ...s, ready: true }));
  })();
  return loading;
}

export function hasSeenHint(key: string): boolean {
  return get(store).seen.has(key);
}

/** Optimistic: hidden at once, queued locally, then posted. */
export async function markHintSeen(key: string, fetcher: Fetch = fetch): Promise<void> {
  const { userId } = get(store);
  store.update((s) => ({
    ...s,
    seen: new Set([...s.seen, key]),
    active: s.active === key ? null : s.active
  }));
  if (!userId) return;
  writeList(lsKey(userId, 'seen'), get(store).seen);
  writeList(lsKey(userId, 'pending'), [...readList(lsKey(userId, 'pending')), key]);
  await flushPending(userId, fetcher);
}

/** A beginner tip came on screen (or left it). While one shows, no anchored
 *  hint claims the slot: one teaching element at a time. */
export function setTipShowing(key: string, showing: boolean): void {
  const s = get(store);
  if (showing ? s.tip === key : s.tip !== key) return;
  store.set(showing ? { ...s, tip: key, active: null } : { ...s, tip: null });
}

/** "Show all tips again": forget every dismissed tip on this device. The
 *  server copy is cleared by `POST /api/me/beginner-tips`. */
export function forgetTips(): void {
  const { userId } = get(store);
  store.update((s) => ({ ...s, seen: new Set([...s.seen].filter((k) => !isTipKey(k))) }));
  if (!userId) return;
  for (const bucket of ['seen', 'pending'] as const) {
    writeList(
      lsKey(userId, bucket),
      readList(lsKey(userId, bucket)).filter((k) => !isTipKey(k))
    );
  }
}

/**
 * At most one hint per view: the first unseen hint to ask gets the slot
 * until it is dismissed or unmounted.
 */
export function claimHint(key: string): boolean {
  const s = get(store);
  if (!s.ready || s.seen.has(key) || s.tip) return false;
  if (s.active && s.active !== key) return false;
  if (s.active !== key) store.update((x) => ({ ...x, active: key }));
  return true;
}

export function releaseHint(key: string): void {
  store.update((s) => (s.active === key ? { ...s, active: null } : s));
}

/** Test-only: forget all state. */
export function resetHintsForTest(): void {
  loading = null;
  store.set(EMPTY);
}
