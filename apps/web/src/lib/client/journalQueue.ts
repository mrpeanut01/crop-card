import { enqueueRecord, listPendingForActiveOwner } from './syncQueue';

export interface QueuedJournalRow {
  rowId: string;
  cropId: string;
  kind: 'note' | 'photo_help';
  text: string;
  hasPhoto: boolean;
  rejected: boolean;
}

export function parseQueuedJournal(
  payload: unknown
): Omit<QueuedJournalRow, 'rowId' | 'rejected'> | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.cropId !== 'string' || !p.cropId) return null;
  if (p.kind !== 'note' && p.kind !== 'photo_help') return null;
  return {
    cropId: p.cropId,
    kind: p.kind,
    text: typeof p.text === 'string' ? p.text : '',
    hasPhoto: typeof p.photo === 'string' && p.photo.length > 0
  };
}

/** Saves a journal note or photo question on this device; the sync queue
 *  replays it when there is signal again. */
export async function queueJournalEntry(entry: {
  cropId: string;
  kind: 'note' | 'photo_help';
  text: string;
  photo: string | null;
}): Promise<string> {
  return enqueueRecord('journal', {
    cropId: entry.cropId,
    kind: entry.kind,
    text: entry.text,
    ...(entry.photo ? { photo: entry.photo } : {}),
    occurredAt: Date.now()
  });
}

/** The active Owner's journal entries still waiting on this phone for one
 *  planting, newest first. */
export async function listQueuedJournal(cropId: string): Promise<QueuedJournalRow[]> {
  const rows = await listPendingForActiveOwner();
  const out: QueuedJournalRow[] = [];
  for (const r of rows) {
    if (r.kind !== 'journal') continue;
    const parsed = parseQueuedJournal(r.payload);
    if (!parsed || parsed.cropId !== cropId) continue;
    out.push({ rowId: r.id, ...parsed, rejected: r.status === 'rejected' });
  }
  return out.reverse();
}
