/**
 * Tasks repository (Phase 12).
 *
 * Supports three task kinds:
 *   primary    — the operation itself (mow, spray, harvest, plant, etc.)
 *   pre-task   — wraps a primary; fires before. (e.g., baler bearings check)
 *   post-task  — wraps a primary; fires after.  (e.g., sprayer decon)
 *
 * Tasks come from three sources:
 *   1. Operator manually scheduling something on /today.
 *   2. Promoting a calendar-engine plugin event to a real task.
 *   3. `materializePluginPrePost(primaryId)` — auto-attaches plugin
 *      templates (cropPlugin.preTasks + equipment.preTasks) whose
 *      conditions match. Idempotent on `pluginTemplateKey` so re-running
 *      doesn't duplicate.
 *
 * Closure: when a primary task's referenced operation lands (e.g. a spray
 * is recorded with `?taskId=<id>`), the event endpoint calls
 * `completeTask(taskId, eventTable, eventId)` to stamp the relation.
 */

import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { db } from './client';
import { equipment, equipmentState, tasks } from './schema';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { EquipmentPreTaskTemplate, EquipmentTemplate } from '$lib/server/equipmentTemplates';
import { SEED_EQUIPMENT_TEMPLATES } from '$lib/server/equipmentTemplates';

export type TaskKind = 'primary' | 'pre-task' | 'post-task';
export type TaskStatus = 'open' | 'completed' | 'aborted';
export type RelatedEventTable =
  | 'spray_event'
  | 'harvest_event'
  | 'insecticide_event'
  | 'hay_cutting'
  | 'fertility_application';

export interface Task {
  id: string;
  title: string;
  body?: string;
  kind: TaskKind;
  linkedToTaskId?: string;
  cropId?: string;
  blockId?: string;
  equipmentId?: string;
  scheduledFor: number;
  completedAt?: number;
  abortedAt?: number;
  abortReason?: string;
  relatedEventTable?: RelatedEventTable;
  relatedEventId?: string;
  pluginTemplateKey?: string;
  recurrenceJson?: string;
  createdById?: string;
  createdAt: number;
}

function rowToTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? undefined,
    kind: row.kind as TaskKind,
    linkedToTaskId: row.linkedToTaskId ?? undefined,
    cropId: row.cropId ?? undefined,
    blockId: row.blockId ?? undefined,
    equipmentId: row.equipmentId ?? undefined,
    scheduledFor: row.scheduledFor.getTime(),
    completedAt: row.completedAt?.getTime(),
    abortedAt: row.abortedAt?.getTime(),
    abortReason: row.abortReason ?? undefined,
    relatedEventTable: (row.relatedEventTable as RelatedEventTable | null) ?? undefined,
    relatedEventId: row.relatedEventId ?? undefined,
    pluginTemplateKey: row.pluginTemplateKey ?? undefined,
    recurrenceJson: row.recurrenceJson ?? undefined,
    createdById: row.createdById ?? undefined,
    createdAt: row.createdAt.getTime()
  };
}

export interface ListFilters {
  fromMs?: number;
  toMs?: number;
  cropId?: string;
  blockId?: string;
  equipmentId?: string;
  status?: TaskStatus;
  kind?: TaskKind;
  limit?: number;
}

export function listTasks(filters: ListFilters = {}): Task[] {
  const conds = [];
  if (filters.fromMs !== undefined) conds.push(gte(tasks.scheduledFor, new Date(filters.fromMs)));
  if (filters.toMs !== undefined) conds.push(lte(tasks.scheduledFor, new Date(filters.toMs)));
  if (filters.cropId) conds.push(eq(tasks.cropId, filters.cropId));
  if (filters.blockId) conds.push(eq(tasks.blockId, filters.blockId));
  if (filters.equipmentId) conds.push(eq(tasks.equipmentId, filters.equipmentId));
  if (filters.kind) conds.push(eq(tasks.kind, filters.kind));
  if (filters.status === 'open') {
    conds.push(isNull(tasks.completedAt));
    conds.push(isNull(tasks.abortedAt));
  } else if (filters.status === 'completed') {
    conds.push(or(isNull(tasks.abortedAt))!);
    conds.push(eq(tasks.completedAt, tasks.completedAt));
  } else if (filters.status === 'aborted') {
    conds.push(eq(tasks.abortedAt, tasks.abortedAt));
  }

  let q = db.select().from(tasks).$dynamic();
  if (conds.length > 0) q = q.where(and(...conds));
  q = q.orderBy(asc(tasks.scheduledFor));
  if (filters.limit) q = q.limit(filters.limit);
  return q.all().map(rowToTask);
}

export function getTask(id: string): Task | undefined {
  const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
  return row ? rowToTask(row) : undefined;
}

export function getTaskWithLinked(id: string): { primary: Task; linked: Task[] } | undefined {
  const primary = getTask(id);
  if (!primary) return undefined;
  const linked = db
    .select()
    .from(tasks)
    .where(eq(tasks.linkedToTaskId, id))
    .orderBy(asc(tasks.scheduledFor))
    .all()
    .map(rowToTask);
  return { primary, linked };
}

export interface CreateTaskInput {
  title: string;
  body?: string;
  kind: TaskKind;
  linkedToTaskId?: string;
  cropId?: string;
  blockId?: string;
  equipmentId?: string;
  scheduledFor: number;
  relatedEventTable?: RelatedEventTable;
  relatedEventId?: string;
  pluginTemplateKey?: string;
  createdById?: string;
}

export function createTask(input: CreateTaskInput): Task {
  const id = randomUUID();
  const row = db
    .insert(tasks)
    .values({
      id,
      title: input.title,
      body: input.body ?? null,
      kind: input.kind,
      linkedToTaskId: input.linkedToTaskId ?? null,
      cropId: input.cropId ?? null,
      blockId: input.blockId ?? null,
      equipmentId: input.equipmentId ?? null,
      scheduledFor: new Date(input.scheduledFor),
      relatedEventTable: input.relatedEventTable ?? null,
      relatedEventId: input.relatedEventId ?? null,
      pluginTemplateKey: input.pluginTemplateKey ?? null,
      createdById: input.createdById ?? null
    })
    .returning()
    .get();
  return rowToTask(row);
}

export interface UpdateTaskInput {
  title?: string;
  body?: string;
  scheduledFor?: number;
}

export function updateTask(id: string, input: UpdateTaskInput): Task {
  const updates: Record<string, unknown> = {};
  if (input.title !== undefined) updates.title = input.title;
  if (input.body !== undefined) updates.body = input.body;
  if (input.scheduledFor !== undefined) updates.scheduledFor = new Date(input.scheduledFor);
  const row = db.update(tasks).set(updates).where(eq(tasks.id, id)).returning().get();
  if (!row) throw new Error(`unknown task id: ${id}`);
  return rowToTask(row);
}

export function completeTask(
  id: string,
  details?: { eventTable?: RelatedEventTable; eventId?: string; occurredAt?: number }
): Task {
  const now = details?.occurredAt ?? Date.now();
  const updates: Record<string, unknown> = { completedAt: new Date(now) };
  if (details?.eventTable) updates.relatedEventTable = details.eventTable;
  if (details?.eventId) updates.relatedEventId = details.eventId;
  const row = db.update(tasks).set(updates).where(eq(tasks.id, id)).returning().get();
  if (!row) throw new Error(`unknown task id: ${id}`);
  return rowToTask(row);
}

export function abortTask(id: string, reason?: string, cascade = true): Task {
  const now = Date.now();
  const row = db
    .update(tasks)
    .set({ abortedAt: new Date(now), abortReason: reason ?? null })
    .where(eq(tasks.id, id))
    .returning()
    .get();
  if (!row) throw new Error(`unknown task id: ${id}`);
  if (cascade) {
    // Cascade abort to pre/post-tasks linked to this primary.
    db.update(tasks)
      .set({ abortedAt: new Date(now), abortReason: reason ?? null })
      .where(and(eq(tasks.linkedToTaskId, id), isNull(tasks.abortedAt), isNull(tasks.completedAt)))
      .run();
  }
  return rowToTask(row);
}

// ─── Plugin template materialization ────────────────────────────────────

interface PluginPrePostContext {
  primaryTaskId: string;
  scheduledFor: number;
  cropPlugin?: CropPlugin;
  equipmentTemplate?: EquipmentTemplate;
  equipmentLastUsedAt?: number;
}

/**
 * Auto-attach plugin pre/post-task templates to a primary task, idempotent
 * on `pluginTemplateKey`. Returns the IDs of newly-created tasks so the
 * caller (typically a UI flow) can highlight them.
 */
export function materializePluginPrePost(ctx: PluginPrePostContext): {
  preTaskIds: string[];
  postTaskIds: string[];
} {
  const preIds: string[] = [];
  const postIds: string[] = [];

  // Existing template keys for this primary — skip duplicates.
  const existingKeys = new Set(
    db
      .select({ key: tasks.pluginTemplateKey })
      .from(tasks)
      .where(eq(tasks.linkedToTaskId, ctx.primaryTaskId))
      .all()
      .map((r) => r.key)
      .filter((k): k is string => !!k)
  );

  // Crop-plugin pre-tasks. We don't know the precise dayBefore semantics
  // without more context (planted-date vs phase anchor); use a simple
  // "1 day before primary" default for v1, with the body documenting the
  // anchor the plugin requested.
  if (ctx.cropPlugin?.preTasks) {
    for (const t of ctx.cropPlugin.preTasks) {
      const key = `crop:${ctx.cropPlugin.pluginId}:pre:${t.key}`;
      if (existingKeys.has(key)) continue;
      const offsetDays = t.daysBeforePlant ?? t.daysBeforeFirstHarvest ?? t.daysBeforePhase ?? 1;
      const created = createTask({
        title: t.title,
        body: t.body,
        kind: 'pre-task',
        linkedToTaskId: ctx.primaryTaskId,
        scheduledFor: ctx.scheduledFor - offsetDays * 24 * 60 * 60 * 1000,
        pluginTemplateKey: key
      });
      preIds.push(created.id);
    }
  }

  // Equipment-template pre-tasks (condition-gated).
  if (ctx.equipmentTemplate?.preTasks) {
    for (const t of ctx.equipmentTemplate.preTasks) {
      if (!equipmentPreTaskMatches(t, ctx.equipmentLastUsedAt, ctx.scheduledFor)) continue;
      const key = `equipment:${ctx.equipmentTemplate.templateId}:pre:${t.key}`;
      if (existingKeys.has(key)) continue;
      const created = createTask({
        title: t.title,
        body: t.body,
        kind: 'pre-task',
        linkedToTaskId: ctx.primaryTaskId,
        scheduledFor: ctx.scheduledFor - 24 * 60 * 60 * 1000,
        pluginTemplateKey: key
      });
      preIds.push(created.id);
    }
  }

  // Crop-plugin post-tasks.
  if (ctx.cropPlugin?.postTasks) {
    for (const t of ctx.cropPlugin.postTasks) {
      const key = `crop:${ctx.cropPlugin.pluginId}:post:${t.key}`;
      if (existingKeys.has(key)) continue;
      const offsetDays = t.daysAfterPlant ?? t.daysAfterHarvest ?? t.daysAfterPhase ?? 0;
      const created = createTask({
        title: t.title,
        body: t.body,
        kind: 'post-task',
        linkedToTaskId: ctx.primaryTaskId,
        scheduledFor: ctx.scheduledFor + offsetDays * 24 * 60 * 60 * 1000,
        pluginTemplateKey: key
      });
      postIds.push(created.id);
    }
  }

  // Equipment-template post-tasks. Only 'always-after-use' fires
  // unconditionally; 'after-restricted-use-chemistry' is wired in when the
  // event endpoint knows the chemistry class.
  if (ctx.equipmentTemplate?.postTasks) {
    for (const t of ctx.equipmentTemplate.postTasks) {
      if (t.condition && t.condition !== 'always-after-use') continue;
      const key = `equipment:${ctx.equipmentTemplate.templateId}:post:${t.key}`;
      if (existingKeys.has(key)) continue;
      const created = createTask({
        title: t.title,
        body: t.body,
        kind: 'post-task',
        linkedToTaskId: ctx.primaryTaskId,
        scheduledFor: ctx.scheduledFor + 24 * 60 * 60 * 1000,
        pluginTemplateKey: key
      });
      postIds.push(created.id);
    }
  }

  return { preTaskIds: preIds, postTaskIds: postIds };
}

function equipmentPreTaskMatches(
  t: EquipmentPreTaskTemplate,
  lastUsedAt: number | undefined,
  scheduledFor: number
): boolean {
  switch (t.condition) {
    case 'always-before-use':
    case undefined:
      return true;
    case 'last-used-gt-days': {
      if (!t.conditionDays) return false;
      if (!lastUsedAt) return true; // never used → fire
      const daysSince = (scheduledFor - lastUsedAt) / (24 * 60 * 60 * 1000);
      return daysSince > t.conditionDays;
    }
    case 'after-storage-period':
      return equipmentPreTaskMatches(
        { ...t, condition: 'last-used-gt-days' },
        lastUsedAt,
        scheduledFor
      );
    default:
      return false;
  }
}

/** Convenience: load equipment + its template + lastUsedAt for a given equipmentId. */
export function loadEquipmentContext(equipmentId: string): {
  template?: EquipmentTemplate;
  lastUsedAt?: number;
} {
  const eq_row = db.select().from(equipment).where(eq(equipment.id, equipmentId)).get();
  if (!eq_row) return {};
  // The current schema doesn't persist a templateId on equipment; map by type+label heuristic.
  const template = SEED_EQUIPMENT_TEMPLATES.find(
    (t) => t.type === eq_row.type && t.label === eq_row.label
  );
  const state = db
    .select()
    .from(equipmentState)
    .where(eq(equipmentState.equipmentId, equipmentId))
    .get();
  return {
    template,
    lastUsedAt: state?.lastUsedAt?.getTime()
  };
}
