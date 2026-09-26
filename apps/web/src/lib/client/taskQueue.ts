import type { QueuedTaskAction } from '$lib/tasks/status';

export interface QueuedTaskPayload {
  taskId: string;
  action: QueuedTaskAction;
  reason?: string;
  occurredAt: number;
}

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
    ...(typeof p.reason === 'string' ? { reason: p.reason } : {})
  };
}

/** Saves a Done or Skip on this device; the sync queue replays it through
 *  POST /api/tasks/close when there is signal again. */
export async function queueTaskAction(
  taskId: string,
  action: QueuedTaskAction,
  reason?: string
): Promise<string> {
  const { enqueueRecord } = await import('./syncQueue');
  const payload: QueuedTaskPayload = {
    taskId,
    action,
    occurredAt: Date.now(),
    ...(reason ? { reason } : {})
  };
  return enqueueRecord('task', payload);
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
