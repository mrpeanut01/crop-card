/**
 * #869 (FU869-3): marked photo journal entries kept on this device so the
 * marks redraw with no signal. Each marked entry the journal shows online is
 * saved with its marks, answer text and JPEG. Per planting the 20 newest
 * entries are kept; per Owner at most 100 copies and 15 MB, the copies saved
 * longest ago going first. Every call keys by the active Owner, and an
 * unknown Owner reads and writes nothing (Invariant 6, client side).
 * `clearCardCaches()` drops them on an Owner switch and on logout.
 */

import { JPEG_DATA_URL_PREFIX, MAX_PHOTO_BYTES, encodeBase64 } from '$lib/journal/photo';
import { journalPhotoUrl, type JournalEntry } from '$lib/journal/model';
import {
  isMarkedEntry,
  isSavedJournalEntry,
  savedEntryOf,
  type SavedJournalEntry
} from '$lib/journal/savedCopy';
import { activeCardOwnerId } from './cardStore';
import { db, type JournalCopyRow } from './dexie';

export const JOURNAL_COPY_PER_PLANTING = 20;
export const JOURNAL_COPY_PER_OWNER = 100;
export const JOURNAL_COPY_MAX_BYTES = 15 * 1024 * 1024;

export interface JournalCopy {
  entry: SavedJournalEntry;
  /** The photo as a JPEG data URL. */
  photo: string;
  savedAt: number;
}

const JPEG_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_PHOTO_CHARS = JPEG_DATA_URL_PREFIX.length + Math.ceil(MAX_PHOTO_BYTES / 3) * 4;

function isPhoto(v: unknown): v is string {
  return typeof v === 'string' && v.length <= MAX_PHOTO_CHARS && JPEG_DATA_URL.test(v);
}

function byteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Infinity;
  }
}

function validRow(
  row: JournalCopyRow | undefined,
  ownerId: string
): row is JournalCopyRow & {
  entry: SavedJournalEntry;
} {
  if (!row || row.ownerId !== ownerId || !isPhoto(row.photo)) return false;
  if (!isSavedJournalEntry(row.entry)) return false;
  return row.entry.id === row.entryId && row.entry.cropId === row.cropId;
}

/** Keeps the newest 20 per planting, then at most 100 and 15 MB per Owner,
 *  dropping the copies saved longest ago first. */
async function trim(ownerId: string, cropId: string): Promise<void> {
  const d = db();
  await d.transaction('rw', d.journalCopies, async () => {
    const forCrop = (
      await d.journalCopies.where('[ownerId+cropId]').equals([ownerId, cropId]).toArray()
    )
      .filter((r) => r.ownerId === ownerId)
      .sort((a, b) => b.createdAt - a.createdAt);
    const drop = new Set(forCrop.slice(JOURNAL_COPY_PER_PLANTING).map((r) => r.entryId));
    const all = (await d.journalCopies.where('ownerId').equals(ownerId).toArray())
      .filter((r) => r.ownerId === ownerId && !drop.has(r.entryId))
      .sort((a, b) => b.savedAt - a.savedAt || b.createdAt - a.createdAt);
    let bytes = 0;
    all.forEach((r, i) => {
      bytes += r.bytes;
      if (i >= JOURNAL_COPY_PER_OWNER || bytes > JOURNAL_COPY_MAX_BYTES) drop.add(r.entryId);
    });
    if (drop.size) {
      await d.journalCopies.bulkDelete([...drop].map((id) => [ownerId, id] as [string, string]));
    }
  });
}

/** The active Owner, or null when there is none or it is not the Owner the
 *  caller read the entries for (a stale tab after a switch). */
function ownerFor(expected?: string | null): string | null {
  const ownerId = activeCardOwnerId();
  if (!ownerId) return null;
  if (expected !== undefined && expected !== ownerId) return null;
  return ownerId;
}

/** Saves a marked entry and its photo. False for an entry with no marks, a
 *  photo that is not a JPEG data URL under the cap, no active Owner, or an
 *  active Owner other than `expectedOwnerId` when it is given. */
export async function saveJournalCopy(
  e: JournalEntry,
  photo: string,
  now: number = Date.now(),
  expectedOwnerId?: string | null
): Promise<boolean> {
  const ownerId = ownerFor(expectedOwnerId);
  const entry = savedEntryOf(e);
  if (!ownerId || !entry || !isPhoto(photo)) return false;
  const bytes = photo.length + byteLength(entry);
  if (bytes > JOURNAL_COPY_MAX_BYTES) return false;
  await db().journalCopies.put({
    ownerId,
    entryId: entry.id,
    cropId: entry.cropId,
    createdAt: entry.createdAt,
    savedAt: now,
    bytes,
    entry,
    photo
  });
  await trim(ownerId, entry.cropId);
  return true;
}

/** Refreshes a saved copy from the entry the server just sent, keeping its
 *  photo. False when this Owner has no copy of it. */
export async function refreshJournalCopy(
  e: JournalEntry,
  now: number = Date.now(),
  expectedOwnerId?: string | null
): Promise<boolean> {
  const ownerId = ownerFor(expectedOwnerId);
  const entry = savedEntryOf(e);
  if (!ownerId || !entry) return false;
  const d = db();
  const row = await d.journalCopies.get([ownerId, entry.id]);
  if (!validRow(row, ownerId) || row.cropId !== entry.cropId) return false;
  await d.journalCopies.update([ownerId, entry.id], {
    entry,
    savedAt: now,
    bytes: row.photo.length + byteLength(entry)
  });
  return true;
}

/** This Owner's saved copies for one planting, newest entry first. Damaged
 *  rows read as absent and are deleted. */
export async function listJournalCopies(cropId: string): Promise<JournalCopy[]> {
  const ownerId = activeCardOwnerId();
  if (!ownerId || !cropId) return [];
  const d = db();
  const rows = await d.journalCopies.where('[ownerId+cropId]').equals([ownerId, cropId]).toArray();
  const good: JournalCopy[] = [];
  const bad: [string, string][] = [];
  for (const row of rows) {
    if (row.ownerId !== ownerId) continue;
    if (validRow(row, ownerId))
      good.push({ entry: row.entry, photo: row.photo, savedAt: row.savedAt });
    else bad.push([ownerId, row.entryId]);
  }
  if (bad.length) await d.journalCopies.bulkDelete(bad);
  return good.sort((a, b) => b.entry.createdAt - a.entry.createdAt);
}

export async function forgetJournalCopy(
  entryId: string,
  expectedOwnerId?: string | null
): Promise<void> {
  const ownerId = ownerFor(expectedOwnerId);
  if (!ownerId || !entryId) return;
  await db().journalCopies.delete([ownerId, entryId]);
}

/** The planting is gone (404): drop every copy of it. */
export async function forgetJournalCopiesFor(
  cropId: string,
  expectedOwnerId?: string | null
): Promise<void> {
  const ownerId = ownerFor(expectedOwnerId);
  if (!ownerId || !cropId) return;
  const d = db();
  const keys = await d.journalCopies
    .where('[ownerId+cropId]')
    .equals([ownerId, cropId])
    .primaryKeys();
  await d.journalCopies.bulkDelete(keys.filter((k) => k[0] === ownerId));
}

/** After the server listed a planting's journal: a copy of an entry the list
 *  should hold but does not was deleted, so it goes too. When the list is
 *  cut at its limit, only copies at least as new as its oldest entry are
 *  judged. */
export async function reconcileJournalCopies(
  cropId: string,
  listed: readonly JournalEntry[],
  complete: boolean,
  expectedOwnerId?: string | null
): Promise<void> {
  const ownerId = ownerFor(expectedOwnerId);
  if (!ownerId || !cropId) return;
  const ids = new Set(listed.map((e) => e.id));
  const oldest = listed.reduce((min, e) => Math.min(min, e.createdAt), Infinity);
  const d = db();
  const rows = await d.journalCopies.where('[ownerId+cropId]').equals([ownerId, cropId]).toArray();
  const gone = rows
    .filter((r) => r.ownerId === ownerId && !ids.has(r.entryId))
    .filter((r) => complete || r.createdAt >= oldest)
    .map((r) => [ownerId, r.entryId] as [string, string]);
  if (gone.length) await d.journalCopies.bulkDelete(gone);
}

export type PhotoFetch = (url: string) => Promise<Response>;

/** The entry's stored photo as a JPEG data URL, `gone` on a 404, or null
 *  when it could not be read now. */
export async function fetchJournalPhoto(
  cropId: string,
  entryId: string,
  fetchImpl: PhotoFetch = fetch
): Promise<string | 'gone' | null> {
  let res: Response;
  try {
    res = await fetchImpl(journalPhotoUrl(cropId, entryId));
  } catch {
    return null;
  }
  if (res.status === 404) return 'gone';
  if (!res.ok) return null;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
  if (bytes.length < 3 || bytes.length > MAX_PHOTO_BYTES) return null;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return JPEG_DATA_URL_PREFIX + encodeBase64(bytes);
}

/** Saves or refreshes a copy of every marked entry the journal shows,
 *  newest first, up to the per-planting cap, for the Owner the entries were
 *  read for. A photo the server answers 404 for drops that entry's copy. */
export async function saveShownJournalCopies(
  entries: readonly JournalEntry[],
  expectedOwnerId: string | null,
  fetchImpl: PhotoFetch = fetch,
  now: number = Date.now()
): Promise<void> {
  if (!expectedOwnerId) return;
  const marked = entries
    .filter(isMarkedEntry)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, JOURNAL_COPY_PER_PLANTING);
  for (const e of marked) {
    if (!ownerFor(expectedOwnerId)) return;
    if (await refreshJournalCopy(e, now, expectedOwnerId)) continue;
    const photo = await fetchJournalPhoto(e.cropId, e.id, fetchImpl);
    if (photo === 'gone') await forgetJournalCopy(e.id, expectedOwnerId);
    else if (photo) await saveJournalCopy(e, photo, now, expectedOwnerId);
  }
}
