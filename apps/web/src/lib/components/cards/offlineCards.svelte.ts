import type { FarmSnapshotRow } from '$lib/client/dexie';
import type { CardSyncOutcome } from '$lib/client/cardSync';

/** Client state for the /cards pages, read only from Dexie so every card
 *  renders with no signal. */
export class OfflineCards {
  row = $state<FarmSnapshotRow | null>(null);
  pinned = $state<string[]>([]);
  loaded = $state(false);
  syncing = $state(false);
  outcome = $state<CardSyncOutcome | null>(null);
  storageKept = $state<boolean | null>(null);

  async load(): Promise<void> {
    try {
      const store = await import('$lib/client/cardStore');
      const [row, pins] = await Promise.all([store.loadSnapshot(), store.listPinned()]);
      this.row = row;
      this.pinned = pins.map((p) => p.key);
    } catch {
      this.row = null;
      this.pinned = [];
    } finally {
      this.loaded = true;
    }
  }

  /** Primes this tab's Owner key, loads what is stored, asks for a fresh
   *  copy when online (a planting added since the page loaded), then reloads
   *  whenever a refresh lands. With no active Owner it forgets
   *  the tab's key and every stored Card instead, and shows nothing. */
  start(ownerId: string | null | undefined): () => void {
    const onSnapshot = () => void this.load();
    let stopped = false;
    (async () => {
      if (!ownerId) {
        try {
          const { forgetActiveOwner } = await import('$lib/client/tenantSwitch');
          await forgetActiveOwner();
        } catch {
          /* no storage: nothing stored to forget */
        }
        this.row = null;
        this.pinned = [];
        this.loaded = true;
        return;
      }
      try {
        const { primeActiveOwnerId } = await import('$lib/client/syncQueue');
        primeActiveOwnerId(ownerId);
      } catch {
        /* no storage: nothing to prime */
      }
      await this.load();
      const { SNAPSHOT_EVENT, syncCardSnapshot } = await import('$lib/client/cardSync');
      if (stopped) return;
      window.addEventListener(SNAPSHOT_EVENT, onSnapshot);
      if (navigator.onLine !== false) void syncCardSnapshot();
    })();
    return () => {
      stopped = true;
      import('$lib/client/cardSync')
        .then(({ SNAPSHOT_EVENT }) => window.removeEventListener(SNAPSHOT_EVENT, onSnapshot))
        .catch(() => undefined);
    };
  }

  async saveForOffline(): Promise<CardSyncOutcome> {
    this.syncing = true;
    try {
      const { syncCardSnapshot, warmCardsShell } = await import('$lib/client/cardSync');
      const outcome = await syncCardSnapshot();
      this.outcome = outcome;
      if (outcome === 'updated' || outcome === 'unchanged') await warmCardsShell();
      await this.load();
      return outcome;
    } finally {
      this.syncing = false;
    }
  }

  isPinned(key: string): boolean {
    return this.pinned.includes(key);
  }

  async togglePin(key: string): Promise<void> {
    const store = await import('$lib/client/cardStore');
    const pinning = !this.isPinned(key);
    if (pinning) await store.pinCard(key);
    else await store.unpinCard(key);
    this.pinned = (await store.listPinned()).map((p) => p.key);
    if (pinning) void this.keepStorage();
  }

  /** Firefox answers `persist()` only after the person replies to its
   *  permission prompt, so the pin shows first and this never blocks it. */
  private async keepStorage(): Promise<void> {
    const { requestPersistentStorage } = await import('$lib/client/offlineStorage');
    this.storageKept = await requestPersistentStorage();
  }

  allPinned(keys: readonly string[]): boolean {
    return keys.length > 0 && keys.every((k) => this.pinned.includes(k));
  }

  /** Pins every key, the first one newest so it sorts ahead of the rest
   *  ("Pin for the barn": the Flock Card, then its members). */
  async pinAll(keys: readonly string[]): Promise<void> {
    const store = await import('$lib/client/cardStore');
    const now = Date.now();
    for (let i = 0; i < keys.length; i++) await store.pinCard(keys[i], now - i);
    this.pinned = (await store.listPinned()).map((p) => p.key);
    void this.keepStorage();
  }

  async unpinAll(keys: readonly string[]): Promise<void> {
    const store = await import('$lib/client/cardStore');
    for (const key of keys) await store.unpinCard(key);
    this.pinned = (await store.listPinned()).map((p) => p.key);
  }
}
