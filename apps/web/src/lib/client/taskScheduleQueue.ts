/** Schedules a calendar suggestion from /today, or keeps it on the phone
 *  when there is no signal (Phase 34A, SO-03 to SO-06). The online try and
 *  any queued replay share one client record id, so a lost response never
 *  makes the task twice, and the server also refuses a second task with the
 *  same `derived:` key. */

import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { isUpdatingResponse, retryAfterSeconds } from '$lib/updating';

/** The exact POST /api/tasks body /today sends for a suggestion. */
export type ScheduleSuggestionBody = {
  title: string;
  body?: string;
  kind: 'primary';
  blockId?: string;
  cropId?: string;
  scheduledFor: number;
  pluginTemplateKey: string; // derived:<kind>:<blockId>:<startMs>
};

export interface QueuedScheduleRow {
  rowId: string;
  title: string;
  scheduledFor: number;
  blockId?: string;
  cropId?: string;
  pluginTemplateKey: string;
  rejected: boolean;
}

export type ScheduleOutcome =
  | { status: 'saved'; alreadyScheduled: boolean }
  | { status: 'queued'; rowId: string }
  | { status: 'refused'; error: string };

const KIND = 'task-schedule';

function recordId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `pending_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** Reads a queued payload back into a row, or null when it is not one. */
export function parseQueuedSchedule(
  rowId: string,
  payload: unknown,
  rejected: boolean
): QueuedScheduleRow | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.title !== 'string' || !p.title) return null;
  if (typeof p.scheduledFor !== 'number' || !Number.isFinite(p.scheduledFor)) return null;
  if (typeof p.pluginTemplateKey !== 'string' || !p.pluginTemplateKey) return null;
  return {
    rowId,
    title: p.title,
    scheduledFor: p.scheduledFor,
    ...(typeof p.blockId === 'string' ? { blockId: p.blockId } : {}),
    ...(typeof p.cropId === 'string' ? { cropId: p.cropId } : {}),
    pluginTemplateKey: p.pluginTemplateKey,
    rejected
  };
}

/** The active Owner's queued suggestion schedules, oldest first, rejected
 *  ones included (the deck leaves those out). */
export async function listQueuedSchedules(): Promise<QueuedScheduleRow[]> {
  const { listPendingForActiveOwner } = await import('./syncQueue');
  const rows = await listPendingForActiveOwner();
  const out: QueuedScheduleRow[] = [];
  for (const r of rows) {
    if (r.kind !== KIND) continue;
    const parsed = parseQueuedSchedule(r.id, r.payload, r.status === 'rejected');
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Queues the body under `id`, unless a live row for the same suggestion is
 *  already waiting, whose id is returned instead (SO-04). */
async function queue(body: ScheduleSuggestionBody, id: string): Promise<ScheduleOutcome> {
  const existing = (await listQueuedSchedules()).find(
    (r) => !r.rejected && r.pluginTemplateKey === body.pluginTemplateKey
  );
  if (existing) return { status: 'queued', rowId: existing.rowId };
  const { enqueueRecord } = await import('./syncQueue');
  const rowId = await enqueueRecord(KIND, body, id);
  return { status: 'queued', rowId };
}

export async function scheduleSuggestion(
  body: ScheduleSuggestionBody,
  opts: { fetchFn?: typeof fetch; online?: boolean } = {}
): Promise<ScheduleOutcome> {
  const id = recordId();
  const online = opts.online ?? isOnline();
  if (!online) return queue(body, id);
  const waiting = (await listQueuedSchedules().catch(() => [])).find(
    (r) => !r.rejected && r.pluginTemplateKey === body.pluginTemplateKey
  );
  if (waiting) return { status: 'queued', rowId: waiting.rowId };

  const fetchFn = opts.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await fetchFn('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CLIENT_RECORD_HEADER]: id },
      body: JSON.stringify(body)
    });
  } catch {
    return queue(body, id);
  }
  if (res.status >= 500) {
    const out = await queue(body, id);
    const { scheduleDrain } = await import('./syncQueue');
    scheduleDrain(isUpdatingResponse(res) ? (retryAfterSeconds(res) + 2) * 1000 : 15_000);
    return out;
  }
  if (!res.ok) {
    const out = (await res.json().catch(() => null)) as { error?: string } | null;
    return { status: 'refused', error: out?.error ?? `HTTP ${res.status}` };
  }
  const out = (await res.json().catch(() => null)) as { alreadyScheduled?: boolean } | null;
  return { status: 'saved', alreadyScheduled: out?.alreadyScheduled === true };
}
