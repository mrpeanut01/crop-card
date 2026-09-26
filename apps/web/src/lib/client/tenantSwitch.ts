/**
 * Tenant-aware service-worker cache coordination (Phase 18d/18h).
 *
 * Runtime cache entries are namespaced per Owner inside the SW (see
 * `swTenantKey.ts`), so an Owner switch no longer wipes them: the page
 * tells the SW which Owner is active and the SW keys reads/writes by it.
 * Logout still wipes every tenant cache.
 *
 * The Dexie queue is intentionally preserved across switches — a helper who
 * recorded offline at Farm A then switches to Farm B should not lose A's
 * records; they drain when A is active again.
 *
 * Offline Card snapshots and pins (Dexie v4) are cleared on every switch and
 * on logout, so a shared device never shows the previous farm's Cards.
 *
 * Best-effort: failures are swallowed so a missing SW never blocks a switch.
 * The SW itself fails safe (unknown owner ⇒ network-only).
 */

import {
  LEGACY_TENANT_CACHE_NAMES,
  SET_ACTIVE_OWNER_MESSAGE,
  SW_META_CACHE,
  TENANT_CACHE_NAMES,
  isValidOwnerId
} from './swTenantKey';

const ACK_TIMEOUT_MS = 1000;

async function activeServiceWorker(): Promise<ServiceWorker | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg?.active ?? null;
  } catch {
    return null;
  }
}

export async function announceActiveOwner(
  ownerId: string | null | undefined,
  opts: { wipe?: boolean } = {}
): Promise<boolean> {
  const sw = await activeServiceWorker();
  if (!sw) return false;
  const message = {
    type: SET_ACTIVE_OWNER_MESSAGE,
    ownerId: isValidOwnerId(ownerId) ? ownerId : null,
    wipe: opts.wipe === true
  };
  if (typeof MessageChannel === 'undefined') {
    sw.postMessage(message);
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(false);
    }, ACK_TIMEOUT_MS);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(true);
    };
    try {
      sw.postMessage(message, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

function rememberActiveOwner(ownerId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (ownerId) sessionStorage.setItem('cropcard.activeOwnerId', ownerId);
    else sessionStorage.removeItem('cropcard.activeOwnerId');
  } catch {
    /* private mode → skip */
  }
}

/** Call BEFORE POSTing /api/session/switch-owner: demotes the SW to
 *  "unknown owner" so no response can be cached or served mid-switch. */
export async function beginOwnerSwitch(): Promise<void> {
  await announceActiveOwner(null);
}

async function clearOfflineCards(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const { clearCardCaches } = await import('./cardStore');
    await clearCardCaches();
  } catch {
    /* IndexedDB unavailable → nothing stored */
  }
}

/** Call after a successful switch. Keeps every Owner's namespaced SW cache
 *  entries (only the SW's active-owner pointer moves) and clears the offline
 *  Card snapshots and pins. */
export async function resetTenantCaches(newOwnerId: string): Promise<void> {
  rememberActiveOwner(newOwnerId);
  await Promise.all([announceActiveOwner(newOwnerId), clearOfflineCards()]);
}

/** Logout: wipe every tenant cache (current + legacy) and the SW's
 *  persisted owner pointer. */
export async function wipeTenantCaches(): Promise<void> {
  rememberActiveOwner(null);
  await Promise.all([announceActiveOwner(null, { wipe: true }), clearOfflineCards()]);
  if (typeof caches === 'undefined') return;
  try {
    const doomed = new Set<string>([
      ...TENANT_CACHE_NAMES,
      ...LEGACY_TENANT_CACHE_NAMES,
      SW_META_CACHE
    ]);
    const names = await caches.keys();
    await Promise.all(names.filter((n) => doomed.has(n)).map((n) => caches.delete(n)));
  } catch {
    /* no Cache Storage → nothing to clean */
  }
}

/** Logout: stop this browser receiving the last user's farm alerts. The
 *  push service then answers 410 for the endpoint and the server drops the
 *  row, so a shared device never shows the previous farm's notifications. */
export async function unsubscribeDevicePush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    await sub?.unsubscribe();
  } catch {
    /* no push support → nothing to unsubscribe */
  }
}

/** Layout-mount entry point: optionally registers the SW, then tells it
 *  which Owner is active (signed in) or wipes tenant caches (signed out). */
export async function syncServiceWorkerTenant(opts: {
  register: boolean;
  signedIn: boolean;
  ownerId: string | null | undefined;
}): Promise<void> {
  if (!opts.signedIn) await Promise.all([wipeTenantCaches(), unsubscribeDevicePush()]);
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (opts.register) {
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch {
      return;
    }
  }
  if (!opts.signedIn) return;
  await announceActiveOwner(opts.ownerId);
  if (!navigator.serviceWorker.controller) {
    navigator.serviceWorker.ready
      .then(() => announceActiveOwner(opts.ownerId))
      .catch(() => undefined);
  }
}
