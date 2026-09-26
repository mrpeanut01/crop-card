/**
 * Offline Card storage (Phase 30, Dexie v4). Every read and write is keyed by
 * the active Owner from the same sessionStorage key the sync queue uses, and
 * an unknown Owner reads nothing and writes nothing (Invariant 6, client
 * side). A snapshot whose bundle names another Owner is never returned.
 */

import type { FarmSnapshot } from '$lib/cards/snapshot';
import { db, type FarmSnapshotRow, type PinnedCardRow } from './dexie';
import { isValidOwnerId } from './swTenantKey';

const ACTIVE_OWNER_KEY = 'cropcard.activeOwnerId';
const UNASSIGNED_OWNER_ID = '__unassigned__';

export function activeCardOwnerId(): string | null {
  if (typeof window === 'undefined') return null;
  let id: string | null;
  try {
    id = sessionStorage.getItem(ACTIVE_OWNER_KEY);
  } catch {
    return null;
  }
  return isValidOwnerId(id) && id !== UNASSIGNED_OWNER_ID ? id : null;
}

export async function saveSnapshot(
  bundle: FarmSnapshot,
  etag: string | null,
  now: number = Date.now()
): Promise<boolean> {
  const ownerId = activeCardOwnerId();
  if (!ownerId || bundle.ownerId !== ownerId) return false;
  await db().farmSnapshots.put({ ownerId, etag, fetchedAt: now, bundle });
  return true;
}

export async function loadSnapshot(): Promise<FarmSnapshotRow | null> {
  const ownerId = activeCardOwnerId();
  if (!ownerId) return null;
  const row = await db().farmSnapshots.get(ownerId);
  if (!row || row.ownerId !== ownerId || row.bundle?.ownerId !== ownerId) return null;
  return row;
}

export async function pinCard(key: string, now: number = Date.now()): Promise<boolean> {
  const ownerId = activeCardOwnerId();
  if (!ownerId || !key) return false;
  await db().pinnedCards.put({ ownerId, key, pinnedAt: now });
  return true;
}

export async function unpinCard(key: string): Promise<boolean> {
  const ownerId = activeCardOwnerId();
  if (!ownerId) return false;
  await db().pinnedCards.delete([ownerId, key]);
  return true;
}

export async function isPinned(key: string): Promise<boolean> {
  const ownerId = activeCardOwnerId();
  if (!ownerId) return false;
  return (await db().pinnedCards.get([ownerId, key])) !== undefined;
}

/** Newest pin first. */
export async function listPinned(): Promise<PinnedCardRow[]> {
  const ownerId = activeCardOwnerId();
  if (!ownerId) return [];
  const rows = await db()
    .pinnedCards.where('[ownerId+pinnedAt]')
    .between([ownerId, -Infinity], [ownerId, Infinity])
    .reverse()
    .toArray();
  return rows.filter((r) => r.ownerId === ownerId);
}

/** Owner switch and logout: drop every Owner's snapshots and pins. */
export async function clearCardCaches(): Promise<void> {
  const d = db();
  await d.transaction('rw', d.farmSnapshots, d.pinnedCards, async () => {
    await d.farmSnapshots.clear();
    await d.pinnedCards.clear();
  });
}
