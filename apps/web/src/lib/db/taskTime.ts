/**
 * Phase 32F (F1-14, F1-18). Time logged when a task is closed. Rows are
 * written only by `recordTaskTime` in `lib/server/taskTime.ts`, inside the
 * close's `writeRecord()` transaction; there is no edit or delete in 32F.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from './client';
import { blocks, crops, taskTimeEntries } from './schema';
import { tenantValues, withTenant } from './tenant';

export interface TimeEntryRow {
  id: string;
  taskId: string | null;
  userId: string | null;
  cropId: string | null;
  blockId: string | null;
  fieldId: string | null;
  startedAt: number | null;
  minutes: number;
  source: 'task-close' | 'manual' | 'timer';
  note: string | null;
  clientRecordId: string | null;
  createdAt: number;
}

export interface TimeEntryInput {
  taskId: string | null;
  userId: string | null;
  cropId?: string | null;
  blockId?: string | null;
  fieldId?: string | null;
  startedAt: number;
  minutes: number;
  source?: 'task-close' | 'manual';
  note?: string | null;
  clientRecordId?: string | null;
}

function toRow(r: typeof taskTimeEntries.$inferSelect): TimeEntryRow {
  return {
    id: r.id,
    taskId: r.taskId ?? null,
    userId: r.userId ?? null,
    cropId: r.cropId ?? null,
    blockId: r.blockId ?? null,
    fieldId: r.fieldId ?? null,
    startedAt: r.startedAt?.getTime() ?? null,
    minutes: r.minutes,
    source: r.source,
    note: r.note ?? null,
    clientRecordId: r.clientRecordId ?? null,
    createdAt: r.createdAt.getTime()
  };
}

export function insertTimeEntry(input: TimeEntryInput): TimeEntryRow {
  const row = db
    .insert(taskTimeEntries)
    .values(
      tenantValues({
        id: randomUUID(),
        taskId: input.taskId,
        userId: input.userId,
        cropId: input.cropId ?? null,
        blockId: input.blockId ?? null,
        fieldId: input.fieldId ?? null,
        startedAt: new Date(input.startedAt),
        minutes: input.minutes,
        source: input.source ?? 'task-close',
        note: input.note ?? null,
        clientRecordId: input.clientRecordId ?? null
      })
    )
    .returning()
    .get();
  return toRow(row);
}

export interface TimeEntryFilter {
  fromMs: number;
  toMs: number;
  cropId?: string;
  userId?: string;
}

/** Rows whose work started in `[fromMs, toMs)`, oldest first. */
export function listTimeEntries(filter: TimeEntryFilter): TimeEntryRow[] {
  const conds = [
    gte(taskTimeEntries.startedAt, new Date(filter.fromMs)),
    lt(taskTimeEntries.startedAt, new Date(filter.toMs))
  ];
  if (filter.cropId) conds.push(eq(taskTimeEntries.cropId, filter.cropId));
  if (filter.userId) conds.push(eq(taskTimeEntries.userId, filter.userId));
  return db
    .select()
    .from(taskTimeEntries)
    .where(withTenant(taskTimeEntries, and(...conds)))
    .orderBy(asc(taskTimeEntries.startedAt), asc(taskTimeEntries.id))
    .all()
    .map(toRow);
}

/** Every row for one planting, whenever it was logged (F1-17). */
export function listTimeEntriesForCrop(cropId: string): TimeEntryRow[] {
  return db
    .select()
    .from(taskTimeEntries)
    .where(withTenant(taskTimeEntries, eq(taskTimeEntries.cropId, cropId)))
    .orderBy(asc(taskTimeEntries.startedAt), asc(taskTimeEntries.id))
    .all()
    .map(toRow);
}

/** Total minutes per planting for the offline snapshot, in one read. */
export function minutesByCrop(cropIds: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  const unique = [...new Set(cropIds)];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    for (const r of db
      .select({
        cropId: taskTimeEntries.cropId,
        minutes: sql<number>`sum(${taskTimeEntries.minutes})`
      })
      .from(taskTimeEntries)
      .where(withTenant(taskTimeEntries, inArray(taskTimeEntries.cropId, chunk)))
      .groupBy(taskTimeEntries.cropId)
      .all()) {
      if (r.cropId && r.minutes > 0) out.set(r.cropId, Number(r.minutes));
    }
  }
  return out;
}

export function listTimeEntriesForTask(taskId: string): TimeEntryRow[] {
  return db
    .select()
    .from(taskTimeEntries)
    .where(withTenant(taskTimeEntries, eq(taskTimeEntries.taskId, taskId)))
    .orderBy(asc(taskTimeEntries.createdAt), asc(taskTimeEntries.id))
    .all()
    .map(toRow);
}

/** The block and field a task's time belongs to: the task's block, else
 *  its planting's block, and that block's field. */
export function placeOfTask(task: { blockId?: string | null; cropId?: string | null }): {
  blockId: string | null;
  fieldId: string | null;
} {
  let blockId = task.blockId ?? null;
  if (!blockId && task.cropId) {
    blockId =
      db
        .select({ blockId: crops.blockId })
        .from(crops)
        .where(withTenant(crops, eq(crops.id, task.cropId)))
        .get()?.blockId ?? null;
  }
  if (!blockId) return { blockId: null, fieldId: null };
  const block = db
    .select({ fieldId: blocks.fieldId })
    .from(blocks)
    .where(withTenant(blocks, eq(blocks.id, blockId)))
    .get();
  return block ? { blockId, fieldId: block.fieldId ?? null } : { blockId: null, fieldId: null };
}
