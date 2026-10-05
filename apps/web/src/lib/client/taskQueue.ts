import type { QueuedTaskAction } from '$lib/tasks/status';
import { CLIENT_RECORD_HEADER } from '$lib/clientRecordHeader';
import { isUpdatingResponse, retryAfterSeconds } from '$lib/updating';

export interface QueuedTaskPayload {
  taskId: string;
  action: QueuedTaskAction;
  reason?: string;
  occurredAt: number;
  /** An animal-care close (32D): the treatment, next due day and Skip
   *  choice ride in the same row, so the replay is one write. */
  healthEvent?: Record<string, unknown>;
  nextDueOn?: string;
  careSkip?: 'skip-this' | 'snooze';
  snoozeDays?: number;
  /** Phase 32F (F1-13): time picked on the Done sheet, whole minutes. */
  minutes?: number;
}

export type CareCloseExtra = Pick<
  QueuedTaskPayload,
  'healthEvent' | 'nextDueOn' | 'careSkip' | 'snoozeDays' | 'minutes'
>;

export interface QueuedTaskRow {
  rowId: string;
  taskId: string;
  action: QueuedTaskAction;
  rejected: boolean;
}

export function parseQueuedTask(payload: unknown): Omit<QueuedTaskPayload, 'occurredAt'> | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.taskId !== 'string' || !p.taskId) return null;
  if (p.action !== 'complete' && p.action !== 'abort') return null;
  return {
    taskId: p.taskId,
    action: p.action,
    ...(typeof p.reason === 'string' ? { reason: p.reason } : {}),
    ...(typeof p.minutes === 'number' ? { minutes: p.minutes } : {})
  };
}

/** Saves a Done or Skip on this device; the sync queue replays it through
 *  POST /api/tasks/close when there is signal again. Pass the client record
 *  id an online try already used, so a response lost on the way back
 *  dedupes on the server instead of saving the dose twice. */
export async function queueTaskAction(
  taskId: string,
  action: QueuedTaskAction,
  reason?: string,
  extra: CareCloseExtra = {},
  clientId?: string
): Promise<string> {
  const { enqueueRecord } = await import('./syncQueue');
  const payload: QueuedTaskPayload = {
    taskId,
    action,
    occurredAt: Date.now(),
    ...(reason ? { reason } : {}),
    ...extra
  };
  return clientId ? enqueueRecord('task', payload, clientId) : enqueueRecord('task', payload);
}

/** The active Owner's waiting task actions, newest last. */
export async function listQueuedTaskActions(): Promise<QueuedTaskRow[]> {
  const { listPendingForActiveOwner } = await import('./syncQueue');
  const rows = await listPendingForActiveOwner();
  const out: QueuedTaskRow[] = [];
  for (const r of rows) {
    if (r.kind !== 'task') continue;
    const parsed = parseQueuedTask(r.payload);
    if (!parsed) continue;
    out.push({
      rowId: r.id,
      taskId: parsed.taskId,
      action: parsed.action,
      rejected: r.status === 'rejected'
    });
  }
  return out;
}

/** Latest waiting action per task; rejected rows are left out so the card
 *  goes back to its real status. */
export function queuedActionMap(rows: readonly QueuedTaskRow[]): Map<string, QueuedTaskAction> {
  const out = new Map<string, QueuedTaskAction>();
  for (const r of rows) if (!r.rejected) out.set(r.taskId, r.action);
  return out;
}

export type TaskCloseSend =
  | { kind: 'saved'; body: unknown }
  | { kind: 'queue'; drainInMs: number | null; updating: boolean }
  | { kind: 'refused'; status: number; error: string | null };

/** One online try of POST /api/tasks/close. A network error, a server error
 *  or the deploy fence's 503 answer `queue`: the caller keeps the close on
 *  the phone under the same client record id, and `drainInMs` says when to
 *  retry (null: wait for signal). Only a 4xx is a refusal. */
export async function sendTaskClose(
  body: unknown,
  clientId: string,
  fetchFn: typeof fetch = fetch
): Promise<TaskCloseSend> {
  let res: Response;
  try {
    res = await fetchFn('/api/tasks/close', {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CLIENT_RECORD_HEADER]: clientId },
      body: JSON.stringify(body)
    });
  } catch {
    return { kind: 'queue', drainInMs: null, updating: false };
  }
  if (res.status >= 500) {
    const updating = isUpdatingResponse(res);
    return {
      kind: 'queue',
      drainInMs: updating ? (retryAfterSeconds(res) + 2) * 1000 : 15_000,
      updating
    };
  }
  if (!res.ok) {
    const out = (await res.json().catch(() => null)) as { error?: string } | null;
    return { kind: 'refused', status: res.status, error: out?.error ?? null };
  }
  return { kind: 'saved', body: await res.json().catch(() => null) };
}
