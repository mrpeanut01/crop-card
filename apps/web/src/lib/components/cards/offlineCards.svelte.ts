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

  /** Primes this tab's Owner key, loads what is stored, then reloads
   *  whenever a background refresh lands. With no active Owner it forgets
   *  the tab's key and every stored Card instead, and shows nothing. */
  start(ownerId: string | null | undefined): () => void {
    const onSnapshot = () => void this.load();
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
      const { SNAPSHOT_EVENT } = await import('$lib/client/cardSync');
      window.addEventListener(SNAPSHOT_EVENT, onSnapshot);
    })();
    return () => {
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
    if (this.isPinned(key)) {
      await store.unpinCard(key);
    } else {
      await store.pinCard(key);
      const { requestPersistentStorage } = await import('$lib/client/offlineStorage');
      this.storageKept = await requestPersistentStorage();
    }
    this.pinned = (await store.listPinned()).map((p) => p.key);
  }
}
