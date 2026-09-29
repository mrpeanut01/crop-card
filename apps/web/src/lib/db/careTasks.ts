/**
 * Animal-care task rows (Phase 32D, D1). A care task's primary key is
 * `tk_care_<planId>_<yyyymmdd>` (ruling D0-1), so `INSERT ... ON CONFLICT`
 * on it is the plan:due dedupe that holds however many writers race.
 */

import { and, asc, eq, isNull, like, sql } from 'drizzle-orm';
import { db } from './client';
import { tasks } from './schema';
import { tenantValues, withTenant } from './tenant';
import { rowToTask, type Task } from './tasks';
import {
  ENGINE_ABORT_REASONS,
  careMetaJson,
  careTaskId,
  careTemplateKey,
  ymdToMs,
  type CareTaskMeta
} from '$lib/animals/carePlans';

export interface CareTaskWrite {
  meta: Omit<CareTaskMeta, 'care'>;
  title: string;
}

/**
 * Writes the task for a plan's due day. A row that already exists is left
 * alone, unless the care engine itself aborted it (the plan was edited or
 * ended and is back): then it is reopened with the current title. Returns
 * true when a row was written or reopened.
 */
export function upsertCareTask(input: CareTaskWrite): boolean {
  const { meta } = input;
  const id = careTaskId(meta.planId, meta.dueOn);
  const recurrenceJson = careMetaJson(meta);
  const res = db
    .insert(tasks)
    .values(
      tenantValues({
        id,
        title: input.title,
        kind: 'primary' as const,
        scheduledFor: new Date(ymdToMs(meta.dueOn)),
        category: 'animal-care' as const,
        pluginTemplateKey: careTemplateKey(meta.planId, meta.dueOn),
        recurrenceJson,
        createdById: null
      })
    )
    .onConflictDoUpdate({
      target: tasks.id,
      set: {
        abortedAt: null,
        abortReason: null,
        title: input.title,
        recurrenceJson,
        scheduledFor: new Date(ymdToMs(meta.dueOn))
      },
      setWhere: and(
        eq(tasks.ownerId, sql`excluded.owner_id`),
        isNull(tasks.completedAt),
        sql`${tasks.abortReason} in (${sql.join(
          ENGINE_ABORT_REASONS.map((r) => sql`${r}`),
          sql`, `
        )})`
      )
    })
    .run();
  return res.changes > 0;
}

/** Open (not done, not skipped) care tasks of the farm, oldest due first. */
export function listOpenCareTasks(): Task[] {
  return db
    .select()
    .from(tasks)
    .where(
      withTenant(
        tasks,
        and(eq(tasks.category, 'animal-care'), isNull(tasks.completedAt), isNull(tasks.abortedAt))
      )
    )
    .orderBy(asc(tasks.scheduledFor), asc(tasks.id))
    .all()
    .map(rowToTask);
}

/** Open care tasks written for one plan. */
export function listOpenTasksForPlan(planId: string): Task[] {
  return db
    .select()
    .from(tasks)
    .where(
      withTenant(
        tasks,
        and(
          like(tasks.pluginTemplateKey, `care:${planId}:%`),
          isNull(tasks.completedAt),
          isNull(tasks.abortedAt)
        )
      )
    )
    .all()
    .map(rowToTask);
}
