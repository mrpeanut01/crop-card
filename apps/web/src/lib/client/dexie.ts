/**
 * Client-side IndexedDB schema for offline-first operation (NFR-02).
 *
 * Two stores:
 *  - `pendingSprayRecords`: spray events the user confirmed while offline.
 *    Drained by the sync queue when connectivity returns.
 *  - `cachedCatalogs`: last-seen plugin and sprayer catalogs so the spray
 *    flow renders even without a network round-trip.
 */

import Dexie, { type Table } from 'dexie';

export interface PendingSprayRecord {
  id: string;
  occurredAt: number;
  payload: unknown;
  attempts: number;
  lastErrorAt?: number;
  lastError?: string;
  createdAt: number;
}

export interface CachedCatalog {
  key: 'plugins' | 'sprayers';
  body: unknown;
  fetchedAt: number;
}

export class CropCardDb extends Dexie {
  pendingSprayRecords!: Table<PendingSprayRecord, string>;
  cachedCatalogs!: Table<CachedCatalog, string>;

  constructor() {
    super('cropcard');
    this.version(1).stores({
      pendingSprayRecords: 'id, createdAt',
      cachedCatalogs: 'key'
    });
  }
}

let _db: CropCardDb | null = null;

export function db(): CropCardDb {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB unavailable in this context');
  }
  if (!_db) _db = new CropCardDb();
  return _db;
}
