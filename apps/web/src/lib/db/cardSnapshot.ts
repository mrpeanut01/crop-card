/**
 * Phase 30F: the tenant-scoped reads behind the offline Card snapshot that
 * the other repos do not expose (planting spacing and counts, task
 * categories, the active Owner's display name).
 */

import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { db } from './client';
import { animalCarePlans, animalHealthEvents, crops, owners, tasks } from './schema';
import { requireOwnerId, unscopedQueryNote, withTenant } from './tenant';
import type {
  SnapshotCarePlan,
  SnapshotPlanting,
  SnapshotTask,
  SnapshotTaskCategory,
  SnapshotTreatment
} from '$lib/cards/snapshot';
import { parseFootprint } from '$lib/farm/footprint';

const DAY_MS = 86_400_000;

function ymd(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function toSnapshotPlanting(r: typeof crops.$inferSelect): SnapshotPlanting {
  return {
    id: r.id,
    blockId: r.blockId,
    cropPluginId: r.cropPluginId,
    varietyDisplayName: r.varietyDisplayName,
    status: r.status as SnapshotPlanting['status'],
    plantingDate: ymd(r.plantingDate),
    harvestedAt: ymd(r.harvestedAt),
    quantityPlanted: r.quantityPlantedHundredths != null ? r.quantityPlantedHundredths / 100 : null,
    quantityUnit: r.quantityUnit ?? null,
    spacingIn: r.spacingIn ?? null,
    rowSpacingIn: r.rowSpacingIn ?? null,
    plantCount: r.plantCount ?? null,
    plantCountProvenance: r.plantCountProvenance ?? null,
    sourceProvenance: r.sourceProvenance ?? null,
    ...layoutOf(r),
    ...(r.establishment ? { establishment: r.establishment } : {}),
    ...(r.sownIndoorsAt ? { sownIndoorsAt: r.sownIndoorsAt.getTime() } : {})
  };
}

function layoutOf(
  r: typeof crops.$inferSelect
): Pick<SnapshotPlanting, 'footprint' | 'spacingPattern'> {
  const footprint = parseFootprint(r.footprintJson);
  if (!footprint) return {};
  return { footprint, spacingPattern: r.spacingPattern ?? null };
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
    .map(toSnapshotPlanting)
    .sort(
      (a, b) =>
        (a.plantingDate ?? '').localeCompare(b.plantingDate ?? '') || a.id.localeCompare(b.id)
    );
}

/** Plantings by id in any status, for a record whose planting is older
 *  than the snapshot keeps. */
export function listPlantingsForCardsByIds(ids: readonly string[]): SnapshotPlanting[] {
  if (!ids.length) return [];
  return db
    .select()
    .from(crops)
    .where(withTenant(crops, inArray(crops.id, [...ids])))
    .all()
    .map(toSnapshotPlanting);
}

/** The planting a harvest or hay record most likely belongs to when it
 *  carries no crop id: the latest one of that crop in that block planted on
 *  or before the record. */
export function plantingIdForRecord(
  blockId: string,
  cropPluginId: string,
  occurredAt: number
): string | null {
  const rows = db
    .select({ id: crops.id, plantingDate: crops.plantingDate })
    .from(crops)
    .where(withTenant(crops, and(eq(crops.blockId, blockId), eq(crops.cropPluginId, cropPluginId))))
    .all();
  const dated = rows
    .map((r) => ({ id: r.id, at: r.plantingDate?.getTime() ?? null }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  const before = dated.find((r) => r.at !== null && r.at <= occurredAt);
  return (before ?? dated[0])?.id ?? null;
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

/** Active care plans, soonest first; undated ("ask your vet") plans last. */
export function listCarePlansForCards(): SnapshotCarePlan[] {
  return db
    .select()
    .from(animalCarePlans)
    .where(withTenant(animalCarePlans, eq(animalCarePlans.active, true)))
    .all()
    .map((r) => ({
      id: r.id,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      kind: r.kind as SnapshotCarePlan['kind'],
      title: r.title,
      intervalDays: r.intervalDays ?? null,
      nextDueAt: r.nextDueAt ? r.nextDueAt.getTime() : null,
      provenance: r.provenance
    }))
    .sort(
      (a, b) =>
        (a.nextDueAt ?? Infinity) - (b.nextDueAt ?? Infinity) ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id)
    );
}

/** Health events given since `sinceMs` (or with a course still running
 *  then), newest first. Display only: no hold is read from these. */
export function listTreatmentsForCards(sinceMs: number): SnapshotTreatment[] {
  const since = new Date(sinceMs);
  return db
    .select({
      id: animalHealthEvents.id,
      subjectType: animalHealthEvents.subjectType,
      subjectId: animalHealthEvents.subjectId,
      kind: animalHealthEvents.kind,
      productName: animalHealthEvents.productName,
      administeredAt: animalHealthEvents.administeredAt,
      courseEndAt: animalHealthEvents.courseEndAt
    })
    .from(animalHealthEvents)
    .where(
      withTenant(
        animalHealthEvents,
        or(
          gte(animalHealthEvents.administeredAt, since),
          gte(animalHealthEvents.courseEndAt, since)
        )
      )
    )
    .orderBy(asc(animalHealthEvents.administeredAt), asc(animalHealthEvents.id))
    .all()
    .map((r) => ({
      id: r.id,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      kind: r.kind,
      productName: r.productName ?? null,
      administeredAt: r.administeredAt.getTime(),
      courseEndAt: r.courseEndAt ? r.courseEndAt.getTime() : null
    }))
    .reverse();
}
