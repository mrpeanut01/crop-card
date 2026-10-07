/**
 * #712. The one writer of a dated planting's own "Sow / Transplant / Plant"
 * task, so the planting day shows on /today. Call inside the planting
 * write's transaction after the planting row and its seed-start tasks
 * exist. The task id is `tk_plant_<cropId>`, so replays and racing writers
 * land on one row; a done or skipped row is never touched. When another
 * live plant task already covers the planting (a seed-start Transplant step,
 * a planting group's anchor task, one the farmer added), this one stays
 * out of the way. Each call re-dates and re-titles an open row the farmer
 * has not edited.
 */

import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { blocks, tasks } from '$lib/db/schema';
import { getCrop } from '$lib/db/crops';
import { tenantValues, withTenant } from '$lib/db/tenant';
import { SEED_START_ABORT_REASON } from '$lib/server/seedStartTasks';
import {
  plantingTaskId,
  plantingTaskTemplateKey,
  plantingTaskTitle
} from '$lib/tasks/plantingTask';

const DAY_MS = 86_400_000;
const LIVE_STATUSES = new Set(['planned', 'active']);

export function syncPlantingTask(cropId: string, nowMs: number = Date.now()): string | null {
  const crop = getCrop(cropId);
  if (!crop || crop.plantingDate == null || !LIVE_STATUSES.has(crop.status)) return null;
  const id = plantingTaskId(cropId);
  const covered = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      withTenant(
        tasks,
        and(
          eq(tasks.cropId, cropId),
          eq(tasks.category, 'plant'),
          ne(tasks.id, id),
          isNull(tasks.abortedAt)
        )
      )
    )
    .limit(1)
    .get();
  if (covered) {
    db.update(tasks)
      .set({ abortedAt: new Date(nowMs), abortReason: SEED_START_ABORT_REASON })
      .where(
        withTenant(tasks, and(eq(tasks.id, id), isNull(tasks.completedAt), isNull(tasks.abortedAt)))
      )
      .run();
    return null;
  }
  if (crop.plantingDate < Math.floor(nowMs / DAY_MS) * DAY_MS) return null;
  const bedName =
    db
      .select({ name: blocks.name })
      .from(blocks)
      .where(withTenant(blocks, eq(blocks.id, crop.blockId)))
      .get()?.name ?? 'the bed';
  const title = plantingTaskTitle({
    establishment: crop.establishment ?? null,
    cropName: crop.varietyDisplayName,
    bedName
  });
  const scheduledFor = new Date(crop.plantingDate);
  db.insert(tasks)
    .values(
      tenantValues({
        id,
        title,
        body: null,
        kind: 'primary' as const,
        cropId,
        blockId: crop.blockId,
        scheduledFor,
        category: 'plant' as const,
        pluginTemplateKey: plantingTaskTemplateKey(cropId),
        createdById: null
      })
    )
    .onConflictDoUpdate({
      target: tasks.id,
      set: {
        title,
        blockId: crop.blockId,
        scheduledFor,
        abortedAt: null,
        abortReason: null
      },
      setWhere: and(
        eq(tasks.ownerId, sql`excluded.owner_id`),
        isNull(tasks.completedAt),
        eq(tasks.userOverridden, false),
        or(isNull(tasks.abortedAt), eq(tasks.abortReason, SEED_START_ABORT_REASON))
      )
    })
    .run();
  return id;
}
