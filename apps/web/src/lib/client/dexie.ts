/**
 * Client-side IndexedDB schema for offline-first operation (NFR-02).
 *
 * Two stores:
 *  - `pendingSprayRecords`: field records the user confirmed while offline.
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
 *
 * #316 (v3): the queue is no longer herbicide-only. Every offline-capable
 * field record — herbicide, insecticide, fungicide, harvest, and hay
 * cutting-start — carries a `kind` discriminator so `drainQueue` can POST
 * each to the right endpoint. The store name stays `pendingSprayRecords`
 * for back-compat (renaming an IndexedDB object store is a destructive
 * migration); the v2→v3 upgrade stamps every existing (herbicide-only)
 * row with `kind: 'herbicide'`.
 */

import Dexie, { type Table } from 'dexie';

/** #316 — offline-capable record kinds. Each maps to a POST endpoint in
 *  syncQueue.ts (ENDPOINT_BY_KIND). Extend both together. */
export type PendingRecordKind =
  | 'herbicide'
  | 'insecticide'
  | 'fungicide'
  | 'harvest'
  | 'hay-cutting';

export interface PendingSprayRecord {
  id: string;
  ownerId: string;
  /** #316 — discriminates which endpoint the payload replays against.
   *  Rows written before v3 lack this field; the v2→v3 upgrade backfills
   *  `'herbicide'`, and readers coalesce a missing value to `'herbicide'`
   *  so a partially-migrated DB never mis-routes. */
  kind?: PendingRecordKind;
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
    // #316 (v3): generalize the queue to all record kinds. Every row
    // written before v3 was a herbicide spray, so stamp the discriminator
    // accordingly. The index set is unchanged (kind is not indexed —
    // drain reads the whole active-owner slice and routes in memory), so
    // this is a pure data backfill with no new store keys.
    this.version(3)
      .stores({
        pendingSprayRecords: 'id, ownerId, createdAt, [ownerId+createdAt]',
        cachedCatalogs: 'key, ownerId, [ownerId+catalogKind]'
      })
      .upgrade(async (tx) => {
        await tx
          .table<PendingSprayRecord>('pendingSprayRecords')
          .toCollection()
          .modify((row) => {
            if (!row.kind) row.kind = 'herbicide';
          });
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
