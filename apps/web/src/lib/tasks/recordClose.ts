export type RecordTaskCloseStatus =
  'closed' | 'already-closed' | 'mismatch' | 'not-found' | 'not-closable' | 'failed';

export interface RecordTaskClose {
  taskId: string;
  status: RecordTaskCloseStatus;
}

export interface TaskRecordTarget {
  blockId?: string | null;
  cropId?: string | null;
  cropPluginId?: string | null;
}

export interface TaskContext {
  id: string;
  title: string;
  /** task.blockId, else the block of task.cropId */
  blockId: string | null;
  cropId: string | null;
  cropPluginId: string | null;
}

/** True when a record saved from a task's Start link is for the block or
 *  crop the task named (TC-07). A task with no block and no crop matches any
 *  record; a record that has not picked a block yet does not mismatch. */
export function recordMatchesTask(task: TaskRecordTarget, record: TaskRecordTarget): boolean {
  if (task.blockId && record.blockId && record.blockId !== task.blockId) return false;
  if (task.cropId && record.cropId && record.cropId !== task.cropId) return false;
  if (
    task.cropId &&
    !record.cropId &&
    record.cropPluginId &&
    task.cropPluginId &&
    record.cropPluginId !== task.cropPluginId
  ) {
    return false;
  }
  return true;
}

/** The catalog key for the line a page shows after an online save, or null. */
export function recordCloseMessageKey(
  close: RecordTaskClose | null | undefined
): 'tasks.recordClose.closed' | 'tasks.recordClose.mismatch' | null {
  if (!close) return null;
  if (close.status === 'closed') return 'tasks.recordClose.closed';
  if (close.status === 'mismatch') return 'tasks.recordClose.mismatch';
  return null;
}

/** True once the server has said the task is closed, so the page stops
 *  sending the task id and stops showing pre-save task lines. */
export function taskClosedBy(close: RecordTaskClose | null | undefined): boolean {
  return close?.status === 'closed' || close?.status === 'already-closed';
}
