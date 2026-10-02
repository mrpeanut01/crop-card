import { getCrop } from '$lib/db/crops';
import { completeTask, getTask, type RelatedEventTable, type Task } from '$lib/db/tasks';
import { parseCareMeta } from '$lib/animals/carePlans';
import { bestEffort } from '$lib/server/recordWrite';
import {
  recordMatchesTask,
  type RecordTaskClose,
  type RecordTaskCloseStatus,
  type TaskContext,
  type TaskRecordTarget
} from '$lib/tasks/recordClose';

function isClosable(task: Task): boolean {
  if (task.category === 'animal-care' && parseCareMeta(task.recurrenceJson)) return false;
  if (task.pluginTemplateKey?.startsWith('seedstart:')) return false;
  return true;
}

function isClosed(task: Task): boolean {
  return task.completedAt !== undefined || task.abortedAt !== undefined;
}

function taskTarget(task: Task): Required<TaskRecordTarget> {
  const crop = task.cropId ? getCrop(task.cropId) : undefined;
  return {
    blockId: task.blockId ?? crop?.blockId ?? null,
    cropId: task.cropId ?? null,
    cropPluginId: crop?.cropPluginId ?? null
  };
}

/** The open, closable task a flow page was opened from, or null (TC-03).
 *  `getTask` is tenant-scoped, so another Owner's id reads as unknown. */
export function loadTaskContext(taskId: string | null | undefined): TaskContext | null {
  if (!taskId) return null;
  const task = getTask(taskId);
  if (!task || isClosed(task) || !isClosable(task)) return null;
  const target = taskTarget(task);
  return {
    id: task.id,
    title: task.title,
    blockId: target.blockId,
    cropId: target.cropId,
    cropPluginId: target.cropPluginId
  };
}

/** Call inside the record's writeRecord / tryGuardedHoldWrite callback.
 *  Runs under a savepoint, so a failed close never rolls back the record. */
export function closeTaskForRecord(input: {
  taskId: string | undefined;
  record: TaskRecordTarget & { blockId: string };
  eventTable: RelatedEventTable;
  eventId: string;
  occurredAt: number;
}): RecordTaskClose | null {
  const taskId = input.taskId;
  if (!taskId) return null;
  const result = bestEffort((): RecordTaskCloseStatus => {
    const task = getTask(taskId);
    if (!task) return 'not-found';
    if (isClosed(task)) return 'already-closed';
    if (!isClosable(task)) return 'not-closable';
    if (!recordMatchesTask(taskTarget(task), input.record)) return 'mismatch';
    completeTask(taskId, {
      eventTable: input.eventTable,
      eventId: input.eventId,
      occurredAt: Math.min(input.occurredAt, Date.now())
    });
    return 'closed';
  });
  return { taskId, status: result.ok ? result.value : 'failed' };
}
