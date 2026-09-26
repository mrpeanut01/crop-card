/**
 * Offline Card refresh (Phase 30F). A conditional GET of
 * `/api/cards/snapshot` on app open, on coming back online and on "Save for
 * offline"; the bundle lands in Dexie through `cardStore`, keyed by the
 * active Owner. A bundle for any other Owner (a switch in another tab) is
 * never stored. The service worker plays no part in the snapshot itself.
 */

import type { FarmSnapshot } from '$lib/cards/snapshot';
import { activeCardOwnerId, loadSnapshot, saveSnapshot } from './cardStore';

export const SNAPSHOT_URL = '/api/cards/snapshot';
export const SNAPSHOT_EVENT = 'cropcard:snapshot';
/** The root layout data a cold offline open of any /cards page needs; the
 *  service worker serves every /cards data request from this one entry. */
export const CARDS_DATA_URL = '/cards/__data.json?x-sveltekit-invalidated=100';

export type CardSyncOutcome =
  'updated' | 'unchanged' | 'offline' | 'no-owner' | 'owner-mismatch' | 'unauthorized' | 'error';

export interface CardSyncOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

let inflight: Promise<CardSyncOutcome> | null = null;

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function announce(outcome: CardSyncOutcome): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SNAPSHOT_EVENT, { detail: { outcome } }));
}

function looksLikeSnapshot(value: unknown): value is FarmSnapshot {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<FarmSnapshot>;
  return (
    typeof v.ownerId === 'string' &&
    typeof v.generatedAt === 'number' &&
    Array.isArray(v.areas) &&
    Array.isArray(v.plantings)
  );
}

async function run(opts: CardSyncOptions): Promise<CardSyncOutcome> {
  if (isOffline()) return 'offline';
  const ownerId = activeCardOwnerId();
  if (!ownerId) return 'no-owner';
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;

  const existing = await loadSnapshot().catch(() => null);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (existing?.etag) headers['if-none-match'] = existing.etag;

  let res: Response;
  try {
    res = await doFetch(SNAPSHOT_URL, { headers, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    return 'offline';
  }

  if (res.status === 304 && existing) {
    const at = now();
    const saved = await saveSnapshot({ ...existing.bundle, generatedAt: at }, existing.etag, at);
    return saved ? 'unchanged' : 'owner-mismatch';
  }
  if (res.status === 401 || res.status === 403) return 'unauthorized';
  if (!res.ok) return 'error';

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return 'error';
  }
  if (!looksLikeSnapshot(body)) return 'error';
  if (body.ownerId !== ownerId) return 'owner-mismatch';
  const saved = await saveSnapshot(body, res.headers.get('etag'), now());
  return saved ? 'updated' : 'owner-mismatch';
}

/** One refresh at a time; concurrent callers share the running one. */
export function syncCardSnapshot(opts: CardSyncOptions = {}): Promise<CardSyncOutcome> {
  if (!inflight) {
    inflight = run(opts)
      .catch((): CardSyncOutcome => 'error')
      .then((outcome) => {
        announce(outcome);
        return outcome;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** Primes the service worker's copy of the /cards layout data so a card
 *  never opened online still opens with no signal. Best effort. */
export async function warmCardsShell(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (isOffline()) return;
  if (typeof navigator === 'undefined' || !navigator.serviceWorker?.controller) return;
  try {
    await fetchImpl(CARDS_DATA_URL, { credentials: 'same-origin' });
  } catch {
    /* next open retries */
  }
}

/** Layout entry point: refresh now and every time the browser comes back
 *  online. Returns the cleanup. */
export function startCardSync(): () => void {
  if (typeof window === 'undefined') return () => {};
  const refresh = () => {
    void syncCardSnapshot().then((outcome) => {
      if (outcome === 'updated' || outcome === 'unchanged') void warmCardsShell();
    });
  };
  window.addEventListener('online', refresh);
  refresh();
  return () => window.removeEventListener('online', refresh);
}
