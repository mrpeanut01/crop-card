/**
 * Animal-care task rows (Phase 32D, D1). A care task's primary key is
 * `tk_care_<planId>_<yyyymmdd>` (ruling D0-1), so `INSERT ... ON CONFLICT`
 * on it is the plan:due dedupe that holds however many writers race.
 */

import { and, asc, eq, isNull, like, sql } from 'drizzle-orm';
import { db } from './client';
import { tasks } from './schema';
import { requireOwnerId, tenantValues, withTenant } from './tenant';
import { ASSIGNABLE_ROLES } from '$lib/tasks/assignee';
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
/**
 * F1-7: a care task written for a plan's next due day keeps the person the
 * plan's latest task was given to, while they are still a working member
 * of the farm. A subquery inside the insert, so /today reads nothing extra.
 */
function inheritedAssignee(planId: string) {
  const ownerId = requireOwnerId();
  const pattern = `care:${planId}:%`;
  const roles = sql.join(
    ASSIGNABLE_ROLES.map((r) => sql`${r}`),
    sql`, `
  );
  const from = sql`from tasks prior
    left join helper_assignments h
      on h.owner_id = prior.owner_id and h.user_id = prior.assignee_user_id
    where prior.owner_id = ${ownerId}
      and prior.plugin_template_key like ${pattern}
    order by prior.scheduled_for desc, prior.id desc
    limit 1`;
  const working = sql`h.status = 'active' and h.role_within_owner in (${roles})`;
  return {
    assigneeUserId: sql`(select case when ${working} then prior.assignee_user_id end ${from})`,
    assignedAt: sql`(select case when ${working} then prior.assigned_at end ${from})`
  };
}

export function upsertCareTask(input: CareTaskWrite): boolean {
  const { meta } = input;
  const id = careTaskId(meta.planId, meta.dueOn);
  const recurrenceJson = careMetaJson(meta);
  const inherited = inheritedAssignee(meta.planId);
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
        createdById: null,
        assigneeUserId: inherited.assigneeUserId,
        assignedAt: inherited.assignedAt
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
