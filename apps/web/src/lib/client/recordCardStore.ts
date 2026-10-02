/**
 * Phase 33D (D1): record cards opened on /records, kept per Owner so they
 * open with no signal. Pins live in `pinnedCards` next to snapshot card pins
 * and never evict; unpinned rows are an LRU of the most recently opened.
 * Every call keys by the active Owner, and an unknown Owner reads and writes
 * nothing (Invariant 6, client side).
 */

import { parseRecordCardKey, recordCardKey } from '$lib/cards/model';
import { isSavedRecordCard, type SavedRecordCard } from '$lib/cards/recordCard';
import { CARD_RECORD_KINDS } from '$lib/db/recordKinds';
import { activeCardOwnerId } from './cardStore';
import { db, type RecordCardRow } from './dexie';

export const RECORD_CARD_PIN_LIMIT = 100;
export const RECORD_CARD_RECENT_LIMIT = 50;
export const RECORD_CARD_MAX_BYTES = 512_000;

const RECORD_PIN_PREFIX = 'rc_';

export type SavedRecordCardRow = RecordCardRow & { model: SavedRecordCard };

function isStorableKey(key: string): boolean {
  const parsed = parseRecordCardKey(key);
  return !!parsed && CARD_RECORD_KINDS.includes(parsed.recordKind);
}

function validRow(row: RecordCardRow | undefined, ownerId: string): row is SavedRecordCardRow {
  if (!row || row.ownerId !== ownerId || !isSavedRecordCard(row.model)) return false;
  return recordCardKey(row.model.recordKind, row.model.rowId) === row.key;
}

function byteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Infinity;
  }
}

async function pinnedRecordKeys(ownerId: string): Promise<Map<string, number>> {
  const pins = await db()
    .pinnedCards.where('ownerId')
    .equals(ownerId)
    .filter((p) => p.ownerId === ownerId && p.key.startsWith(RECORD_PIN_PREFIX))
    .toArray();
  return new Map(pins.map((p) => [p.key, p.pinnedAt]));
}

/** Keeps the newest unpinned rows of this Owner and deletes the rest. */
async function trimRecent(ownerId: string): Promise<void> {
  const d = db();
  await d.transaction('rw', d.recordCards, d.pinnedCards, async () => {
    const pinned = await pinnedRecordKeys(ownerId);
    const rows = await d.recordCards.where('ownerId').equals(ownerId).toArray();
    const unpinned = rows
      .filter((r) => r.ownerId === ownerId && !pinned.has(r.key))
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    const drop = unpinned
      .slice(RECORD_CARD_RECENT_LIMIT)
      .map((r) => [ownerId, r.key] as [string, string]);
    if (drop.length) await d.recordCards.bulkDelete(drop);
  });
}

export async function saveRecordCard(
  model: SavedRecordCard,
  now: number = Date.now()
): Promise<boolean> {
  const ownerId = activeCardOwnerId();
  if (!ownerId || !isSavedRecordCard(model)) return false;
  const key = recordCardKey(model.recordKind, model.rowId);
  if (!isStorableKey(key)) return false;
  const stored: SavedRecordCard = {
    v: 1,
    recordKind: model.recordKind,
    rowId: model.rowId,
    cards: model.cards,
    origin: model.origin
  };
  if (byteLength(stored) > RECORD_CARD_MAX_BYTES) return false;
  await db().recordCards.put({ ownerId, key, model: stored, savedAt: now, lastOpenedAt: now });
  await trimRecent(ownerId);
  return true;
}

export async function openRecordCard(
  key: string,
  now: number = Date.now()
): Promise<{ model: SavedRecordCard; savedAt: number } | null> {
  const ownerId = activeCardOwnerId();
  if (!ownerId || !key) return null;
  const row = await db().recordCards.get([ownerId, key]);
  if (!row) return null;
  if (!validRow(row, ownerId)) {
    if (row.ownerId === ownerId) await forgetRecordCard(key);
    return null;
  }
  await db().recordCards.update([ownerId, key], { lastOpenedAt: now });
  return { model: row.model, savedAt: row.savedAt };
}

/** A deleted or voided record: drop the saved copy and its pin. */
export async function forgetRecordCard(key: string): Promise<void> {
  const ownerId = activeCardOwnerId();
  if (!ownerId || !key) return;
  const d = db();
  await d.transaction('rw', d.recordCards, d.pinnedCards, async () => {
    await d.recordCards.delete([ownerId, key]);
    await d.pinnedCards.delete([ownerId, key]);
  });
}

export async function isRecordCardPinned(key: string): Promise<boolean> {
  const ownerId = activeCardOwnerId();
  if (!ownerId || !key) return false;
  const pin = await db().pinnedCards.get([ownerId, key]);
  return !!pin && pin.ownerId === ownerId;
}

export async function pinRecordCard(
  key: string,
  now: number = Date.now()
): Promise<'pinned' | 'limit' | 'missing' | 'no-owner'> {
  const ownerId = activeCardOwnerId();
  if (!ownerId) return 'no-owner';
  if (!isStorableKey(key)) return 'missing';
  const d = db();
  return d.transaction('rw', d.recordCards, d.pinnedCards, async () => {
    const row = await d.recordCards.get([ownerId, key]);
    if (!validRow(row, ownerId)) return 'missing' as const;
    const pins = await pinnedRecordKeys(ownerId);
    if (pins.has(key)) return 'pinned' as const;
    if (pins.size >= RECORD_CARD_PIN_LIMIT) return 'limit' as const;
    await d.pinnedCards.put({ ownerId, key, pinnedAt: now });
    return 'pinned' as const;
  });
}

export async function unpinRecordCard(key: string): Promise<void> {
  const ownerId = activeCardOwnerId();
  if (!ownerId || !key) return;
  await db().pinnedCards.delete([ownerId, key]);
  await trimRecent(ownerId);
}

/** Pinned newest pin first, then recent newest opened first. Damaged rows
 *  read as absent and are deleted. */
export async function listSavedRecordCards(): Promise<{
  pinned: SavedRecordCardRow[];
  recent: SavedRecordCardRow[];
}> {
  const ownerId = activeCardOwnerId();
  if (!ownerId) return { pinned: [], recent: [] };
  const [rows, pins] = await Promise.all([
    db().recordCards.where('ownerId').equals(ownerId).toArray(),
    pinnedRecordKeys(ownerId)
  ]);
  const good: SavedRecordCardRow[] = [];
  const bad: string[] = [];
  for (const row of rows) {
    if (row.ownerId !== ownerId) continue;
    if (validRow(row, ownerId)) good.push(row);
    else bad.push(row.key);
  }
  for (const key of bad) await forgetRecordCard(key);
  const pinned = good
    .filter((r) => pins.has(r.key))
    .sort((a, b) => (pins.get(b.key) ?? 0) - (pins.get(a.key) ?? 0));
  const recent = good
    .filter((r) => !pins.has(r.key))
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  return { pinned, recent };
}
