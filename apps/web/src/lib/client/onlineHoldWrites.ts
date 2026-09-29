/**
 * Treatments, moves and sprays this phone saved online that the stored
 * offline snapshot may not show yet (32D, D1-04). Nothing is queued for an
 * online save, so without this a card would keep reading "No holds on file"
 * from the older snapshot. Each save is noted per Owner in localStorage and
 * counts as unsynced for the hold reader until a snapshot fetch that
 * started after it succeeds, or until the snapshot would read as stale
 * anyway. The note also starts that fetch.
 */

import { HOLD_CONFIRM_MAX_AGE_MS } from '$lib/cards/build/animalHolds';
import { activeCardOwnerId } from './cardStore';

export type HoldWriteKind =
  'animal-health' | 'animal-move' | 'herbicide' | 'insecticide' | 'fungicide';

export interface OnlineHoldWrite {
  at: number;
  kind: HoldWriteKind;
  payload: Record<string, unknown>;
}

const PREFIX = 'cropcard.onlineHoldWrites.';
const MAX_ROWS = 200;
/** Past this the snapshot reads as stale on its own, so the note can go. */
export const ONLINE_HOLD_WRITE_TTL_MS = HOLD_CONFIRM_MAX_AGE_MS + 60 * 60 * 1000;

const SPRAY = new Set<HoldWriteKind>(['herbicide', 'insecticide', 'fungicide']);

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function slim(kind: HoldWriteKind, payload: unknown): Record<string, unknown> {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  if (SPRAY.has(kind)) return { blockId: p.blockId };
  const out: Record<string, unknown> = {};
  for (const k of ['subjectType', 'subjectId', 'toGroupId', 'animalIds', 'healthEvent']) {
    if (p[k] !== undefined) out[k] = p[k];
  }
  return out;
}

function read(ownerId: string, now: number): OnlineHoldWrite[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = JSON.parse(s.getItem(PREFIX + ownerId) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (r): r is OnlineHoldWrite =>
        !!r &&
        typeof r === 'object' &&
        typeof (r as OnlineHoldWrite).at === 'number' &&
        typeof (r as OnlineHoldWrite).kind === 'string' &&
        now - (r as OnlineHoldWrite).at < ONLINE_HOLD_WRITE_TTL_MS
    );
  } catch {
    return [];
  }
}

function write(ownerId: string, rows: OnlineHoldWrite[]): void {
  const s = storage();
  if (!s) return;
  try {
    if (rows.length === 0) s.removeItem(PREFIX + ownerId);
    else s.setItem(PREFIX + ownerId, JSON.stringify(rows.slice(-MAX_ROWS)));
  } catch {
    /* storage full or blocked: the snapshot refresh still runs */
  }
}

/** The active Owner's notes that are still open. */
export function listOnlineHoldWrites(now: number = Date.now()): OnlineHoldWrite[] {
  const ownerId = activeCardOwnerId();
  return ownerId ? read(ownerId, now) : [];
}

/** Drops notes made before a snapshot fetch that started at `startedAt`
 *  and succeeded, since that snapshot already carries them. */
export function clearOnlineHoldWritesBefore(startedAt: number, now: number = Date.now()): void {
  const ownerId = activeCardOwnerId();
  if (!ownerId) return;
  const rows = read(ownerId, now);
  const kept = rows.filter((r) => r.at >= startedAt);
  if (kept.length !== rows.length || rows.length === 0) write(ownerId, kept);
}

/** Notes an online save that can start or lengthen a hold and asks for a
 *  fresh snapshot. Never throws. */
export function noteOnlineHoldWrite(
  kind: HoldWriteKind,
  payload: unknown,
  now: number = Date.now()
): void {
  const ownerId = activeCardOwnerId();
  if (ownerId) {
    const rows = read(ownerId, now);
    rows.push({ at: now, kind, payload: slim(kind, payload) });
    write(ownerId, rows);
  }
  void import('./cardSync')
    .then(({ refreshCardSnapshotAfterWrite }) => refreshCardSnapshotAfterWrite())
    .catch(() => {});
}
