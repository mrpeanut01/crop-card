/**
 * Client-side IndexedDB schema for offline-first operation (NFR-02).
 *
 * Two stores:
 *  - `pendingSprayRecords`: spray events the user confirmed while offline.
 *    Drained by the sync queue when connectivity returns.
 *  - `cachedCatalogs`: last-seen plugin and sprayer catalogs so the spray
 *    flow renders even without a network round-trip.
 *
 * Phase 18h (multi-tenant): both stores now carry an `ownerId` field. The
 * v2 schema upgrade stamps existing rows with the current `activeOwnerId`
 * captured from a cookie sniffer (the value the layout writes to
 * sessionStorage on Owner switch). When a helper switches owners mid-
 * session, the queue does NOT drain — the badge surfaces "N pending for
 * <other farm>" so offline records they took at Farm A don't vanish when
 * they pick Farm B. They drain when A is active again.
 */

import Dexie, { type Table } from 'dexie';

export interface PendingSprayRecord {
  id: string;
  ownerId: string;
  occurredAt: number;
  payload: unknown;
  attempts: number;
  lastErrorAt?: number;
  lastError?: string;
  createdAt: number;
}

export interface CachedCatalog {
  /** Composite of `ownerId:key` for the primary index. */
  key: string;
  ownerId: string;
  catalogKind: 'plugins' | 'sprayers';
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
    this.version(2)
      .stores({
        pendingSprayRecords: 'id, ownerId, createdAt, [ownerId+createdAt]',
        cachedCatalogs: 'key, ownerId, [ownerId+catalogKind]'
      })
      .upgrade(async (tx) => {
        const fallback = currentOwnerIdFromCookie() ?? 'owner_home_farm';
        await tx
          .table<PendingSprayRecord>('pendingSprayRecords')
          .toCollection()
          .modify((row) => {
            if (!row.ownerId) row.ownerId = fallback;
          });
        // The old cachedCatalogs used `key` ∈ {'plugins','sprayers'} as a
        // bare string PK. Migrate to the composite `ownerId:catalogKind`
        // form, preserving the body.
        const tbl = tx.table<CachedCatalog>('cachedCatalogs');
        const rows = await tbl.toArray();
        for (const r of rows) {
          const kind = (r as unknown as { key?: string }).key as 'plugins' | 'sprayers' | undefined;
          if (kind === 'plugins' || kind === 'sprayers') {
            await tbl.delete(r.key);
            await tbl.put({
              key: `${fallback}:${kind}`,
              ownerId: fallback,
              catalogKind: kind,
              body: r.body,
              fetchedAt: r.fetchedAt
            });
          }
        }
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

/** Sniff the active Owner from the same cookie/sessionStorage pair the
 *  server-side hooks set. Used during the v1→v2 Dexie migration before
 *  the page has had a chance to plumb it through. */
function currentOwnerIdFromCookie(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = sessionStorage.getItem('cropcard.activeOwnerId');
    if (stored) return stored;
  } catch {
    /* private mode → fall through */
  }
  // No usable signal. Return null and let the caller pick the Home Farm
  // fallback.
  return null;
}
