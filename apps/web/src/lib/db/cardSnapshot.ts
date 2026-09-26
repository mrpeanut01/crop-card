/**
 * Phase 30F: the tenant-scoped reads behind the offline Card snapshot that
 * the other repos do not expose (planting spacing and counts, task
 * categories, the active Owner's display name).
 */

import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from './client';
import { crops, owners, tasks } from './schema';
import { requireOwnerId, unscopedQueryNote, withTenant } from './tenant';
import type { SnapshotPlanting, SnapshotTask, SnapshotTaskCategory } from '$lib/cards/snapshot';

const DAY_MS = 86_400_000;

function ymd(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Active and planned plantings, plus anything harvested in the last
 *  `harvestedWithinDays` so a just-finished bed still has its card. */
export function listPlantingsForCards(now: number, harvestedWithinDays = 30): SnapshotPlanting[] {
  const rows = db
    .select()
    .from(crops)
    .where(
      withTenant(
        crops,
        or(
          inArray(crops.status, ['active', 'planned']),
          and(
            eq(crops.status, 'harvested'),
            gte(crops.harvestedAt, new Date(now - harvestedWithinDays * DAY_MS))
          )
        )
      )
    )
    .all();
  return rows
    .map((r) => ({
      id: r.id,
      blockId: r.blockId,
      cropPluginId: r.cropPluginId,
      varietyDisplayName: r.varietyDisplayName,
      status: r.status as SnapshotPlanting['status'],
      plantingDate: ymd(r.plantingDate),
      harvestedAt: ymd(r.harvestedAt),
      quantityPlanted:
        r.quantityPlantedHundredths != null ? r.quantityPlantedHundredths / 100 : null,
      quantityUnit: r.quantityUnit ?? null,
      spacingIn: r.spacingIn ?? null,
      rowSpacingIn: r.rowSpacingIn ?? null,
      plantCount: r.plantCount ?? null,
      plantCountProvenance: r.plantCountProvenance ?? null,
      sourceProvenance: r.sourceProvenance ?? null
    }))
    .sort(
      (a, b) =>
        (a.plantingDate ?? '').localeCompare(b.plantingDate ?? '') || a.id.localeCompare(b.id)
    );
}

/** Open tasks scheduled between `fromMs` and `toMs`, oldest first. */
export function listOpenTasksForCards(fromMs: number, toMs: number): SnapshotTask[] {
  return db
    .select()
    .from(tasks)
    .where(
      withTenant(
        tasks,
        and(
          isNull(tasks.completedAt),
          isNull(tasks.abortedAt),
          gte(tasks.scheduledFor, new Date(fromMs)),
          lte(tasks.scheduledFor, new Date(toMs))
        )
      )
    )
    .all()
    .map((t) => ({
      id: t.id,
      title: t.title,
      category: (t.category as SnapshotTaskCategory | null) ?? null,
      scheduledFor: t.scheduledFor.getTime(),
      cropId: t.cropId ?? null,
      blockId: t.blockId ?? null,
      equipmentId: t.equipmentId ?? null
    }))
    .sort((a, b) => a.scheduledFor - b.scheduledFor || a.id.localeCompare(b.id));
}

export function activeOwnerName(): string | null {
  const ownerId = requireOwnerId();
  unscopedQueryNote('owners is the tenant registry; read only the active Owner row by id');
  const row = db.select({ name: owners.name }).from(owners).where(eq(owners.id, ownerId)).get();
  return row?.name ?? null;
}
