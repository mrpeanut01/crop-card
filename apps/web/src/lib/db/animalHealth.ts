import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNotNull, or } from 'drizzle-orm';
import { db } from './client';
import {
  animalHealthEvents,
  animalLocations,
  animals,
  organicTreatmentReviews,
  recordDeletions,
  stockMovements
} from './schema';
import { tenantValues, withTenant } from './tenant';
import { LOCK_WINDOW_MS } from './recordKinds';
import type { AnimalSubjectType } from '$lib/animals/model';
import {
  HOLD_BEARING_KINDS,
  type HealthEventKind,
  type LabelUseDeclaration
} from '$lib/safety/animalWithdrawal';

export interface AnimalHealthEvent {
  id: string;
  subjectType: AnimalSubjectType;
  subjectId: string;
  kind: HealthEventKind;
  productPluginId: string | null;
  productName: string | null;
  /** JSON array of the stock bottle's name and active ingredients. */
  stockProductText?: string | null;
  stockItemId: string | null;
  lotNumber: string | null;
  dose: number | null;
  doseUnit: string | null;
  route: string | null;
  administeredAt: number;
  courseEndAt: number | null;
  labelUse: LabelUseDeclaration | null;
  vetName: string | null;
  /** Append-only owner entries as JSON (`WithdrawalEntry[]`). */
  vetDirectedWithdrawal: string | null;
  /** The kernel verdict at write time (`WithdrawalClear` as JSON). */
  withdrawalClear: string | null;
  rulesVersion: string | null;
  foodProducingAtRecord: boolean;
  notes: string | null;
  performedById: string | null;
  clientRecordId: string | null;
  lockedAt: number | null;
  /** C-35: the product's label data when recorded (JSON). */
  holdParamsJson?: string | null;
  /** C-35: saved more than 48 hours after the dose. */
  recordedLate?: boolean;
  createdAt: number;
  updatedAt: number;
}

type Row = typeof animalHealthEvents.$inferSelect;

function rowTo(row: Row): AnimalHealthEvent {
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    kind: row.kind,
    productPluginId: row.productPluginId ?? null,
    productName: row.productName ?? null,
    stockProductText: row.stockProductText ?? null,
    stockItemId: row.stockItemId ?? null,
    lotNumber: row.lotNumber ?? null,
    dose: row.dose ?? null,
    doseUnit: row.doseUnit ?? null,
    route: row.route ?? null,
    administeredAt: row.administeredAt.getTime(),
    courseEndAt: row.courseEndAt ? row.courseEndAt.getTime() : null,
    labelUse: row.labelUse ?? null,
    vetName: row.vetName ?? null,
    vetDirectedWithdrawal: row.vetDirectedWithdrawal ?? null,
    withdrawalClear: row.withdrawalClear ?? null,
    rulesVersion: row.rulesVersion ?? null,
    foodProducingAtRecord: row.foodProducingAtRecord,
    notes: row.notes ?? null,
    performedById: row.performedById ?? null,
    clientRecordId: row.clientRecordId ?? null,
    lockedAt: row.lockedAt ? row.lockedAt.getTime() : null,
    holdParamsJson: row.holdParamsJson ?? null,
    recordedLate: row.recordedLate,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime()
  };
}

export interface InsertHealthEventInput {
  id?: string;
  subjectType: AnimalSubjectType;
  subjectId: string;
  kind: HealthEventKind;
  productPluginId?: string | null;
  productName?: string | null;
  stockProductText?: string | null;
  stockItemId?: string | null;
  lotNumber?: string | null;
  dose?: number | null;
  doseUnit?: string | null;
  route?: string | null;
  administeredAt: number;
  courseEndAt?: number | null;
  labelUse?: LabelUseDeclaration | null;
  vetName?: string | null;
  vetDirectedWithdrawal?: string | null;
  withdrawalClear: string | null;
  rulesVersion: string;
  foodProducingAtRecord: boolean;
  holdParamsJson?: string | null;
  notes?: string | null;
  performedById: string | null;
  clientRecordId?: string | null;
  createdAt?: number;
}

export function insertHealthEvent(input: InsertHealthEventInput): AnimalHealthEvent {
  const now = input.createdAt ?? Date.now();
  return rowTo(
    db
      .insert(animalHealthEvents)
      .values(
        tenantValues({
          id: input.id ?? randomUUID(),
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          kind: input.kind,
          productPluginId: input.productPluginId ?? null,
          productName: input.productName?.trim() || null,
          stockProductText: input.stockProductText ?? null,
          stockItemId: input.stockItemId ?? null,
          lotNumber: input.lotNumber?.trim() || null,
          dose: input.dose ?? null,
          doseUnit: input.doseUnit?.trim() || null,
          route: input.route ?? null,
          administeredAt: new Date(input.administeredAt),
          courseEndAt: input.courseEndAt ? new Date(input.courseEndAt) : null,
          labelUse: input.labelUse ?? null,
          vetName: input.vetName?.trim() || null,
          vetDirectedWithdrawal: input.vetDirectedWithdrawal ?? null,
          withdrawalClear: input.withdrawalClear,
          rulesVersion: input.rulesVersion,
          foodProducingAtRecord: input.foodProducingAtRecord,
          notes: input.notes?.trim() || null,
          performedById: input.performedById,
          clientRecordId: input.clientRecordId ?? null,
          holdParamsJson: input.holdParamsJson ?? null,
          recordedLate: input.administeredAt < now - LOCK_WINDOW_MS,
          createdAt: new Date(now),
          updatedAt: new Date(now)
        })
      )
      .returning()
      .get()
  );
}

export function getHealthEvent(id: string): AnimalHealthEvent | undefined {
  const row = db
    .select()
    .from(animalHealthEvents)
    .where(withTenant(animalHealthEvents, eq(animalHealthEvents.id, id)))
    .get();
  return row ? rowTo(row) : undefined;
}

/** One subject's health events, oldest first. */
export function listHealthEvents(
  subjectType: AnimalSubjectType,
  subjectId: string
): AnimalHealthEvent[] {
  return db
    .select()
    .from(animalHealthEvents)
    .where(
      withTenant(
        animalHealthEvents,
        eq(animalHealthEvents.subjectType, subjectType),
        eq(animalHealthEvents.subjectId, subjectId)
      )
    )
    .orderBy(asc(animalHealthEvents.administeredAt), asc(animalHealthEvents.createdAt))
    .all()
    .map(rowTo);
}

/** Health events that can carry a hold (C-19), saved since a moment,
 *  newest first, for the owner's covered-logs alert on /today (C-06). */
export function listHealthEventsRecordedSince(sinceMs: number, limit = 50): AnimalHealthEvent[] {
  return db
    .select()
    .from(animalHealthEvents)
    .where(
      withTenant(
        animalHealthEvents,
        and(
          gte(animalHealthEvents.createdAt, new Date(sinceMs)),
          or(
            inArray(animalHealthEvents.kind, [...HOLD_BEARING_KINDS]),
            isNotNull(animalHealthEvents.productPluginId),
            isNotNull(animalHealthEvents.productName)
          )
        )
      )
    )
    .orderBy(desc(animalHealthEvents.createdAt))
    .limit(limit)
    .all()
    .map(rowTo);
}

export interface SubjectRef {
  subjectType: AnimalSubjectType;
  subjectId: string;
}

/** Health events of several subjects, for the withdrawal gate. */
export function listHealthEventsForSubjects(subjects: readonly SubjectRef[]): AnimalHealthEvent[] {
  const animalIds = subjects.filter((s) => s.subjectType === 'animal').map((s) => s.subjectId);
  const groupIds = subjects.filter((s) => s.subjectType === 'group').map((s) => s.subjectId);
  const read = (type: AnimalSubjectType, ids: string[]) =>
    ids.length === 0
      ? []
      : db
          .select()
          .from(animalHealthEvents)
          .where(
            withTenant(
              animalHealthEvents,
              and(
                eq(animalHealthEvents.subjectType, type),
                inArray(animalHealthEvents.subjectId, [...new Set(ids)])
              )
            )
          )
          .all()
          .map(rowTo);
  return [...read('animal', animalIds), ...read('group', groupIds)];
}

/** Appends to the owner entries. The record's own write-time verdict and
 *  rules version are never rewritten; each entry carries the verdict
 *  recomputed when it was added (C-01, C-18). */
export function saveWithdrawalEntries(
  id: string,
  entriesJson: string,
  now = Date.now()
): AnimalHealthEvent | undefined {
  const row = db
    .update(animalHealthEvents)
    .set({ vetDirectedWithdrawal: entriesJson, updatedAt: new Date(now) })
    .where(withTenant(animalHealthEvents, eq(animalHealthEvents.id, id)))
    .returning()
    .get();
  return row ? rowTo(row) : undefined;
}

/**
 * FR-09 for animal health records. An event that carries a hold on a
 * subject that was food-producing when recorded, or is now, or ever was,
 * locks 48 hours after it was given (C-20), and the lock is stamped once.
 * Returns the lock time, or undefined while the record can still change.
 * @hold-exempt: stamps locked_at only
 */
export function evaluateHealthLock(
  event: AnimalHealthEvent,
  opts: { carriesHold: boolean; foodProducingNow: boolean },
  now = Date.now()
): number | undefined {
  if (event.lockedAt) return event.lockedAt;
  if (!opts.carriesHold) return undefined;
  if (!event.foodProducingAtRecord && !opts.foodProducingNow) return undefined;
  if (now - event.administeredAt < LOCK_WINDOW_MS) return undefined;
  const lockedAt = event.administeredAt + LOCK_WINDOW_MS;
  db.update(animalHealthEvents)
    .set({ lockedAt: new Date(lockedAt) })
    .where(withTenant(animalHealthEvents, eq(animalHealthEvents.id, event.id)))
    .run();
  return lockedAt;
}

export interface HealthTombstone {
  recordId: string;
  deletedAt: number;
  deletedBy: string | null;
  reason: string | null;
  /** C-26: false only when the owner said the dose was never given. */
  dosed: boolean;
  event: AnimalHealthEvent;
  /** 33B (B-26): the organic review the treatment had when deleted. Its
   *  row cascades away with the treatment, so a dose that was given keeps
   *  its answer here. */
  organicReview?: TombstoneOrganicReview | null;
}

export interface TombstoneOrganicReview {
  outcome: 'status-lost' | 'not-affected';
  reason: string;
  createdBy: string | null;
  createdAt: number;
  lockedAt: number | null;
}

/** The stock note `deductHealthStock` links a dose's movement with. */
export const healthStockNote = (eventId: string) => `animal-health:${eventId}`;

/** Deletes an event, leaving a tombstone that keeps its hold unless it was
 *  never given (C-26). A dose that was never given also gives its stock
 *  back, like a deleted spray (review round 8); one that was given used it. */
export function deleteHealthEvent(
  event: AnimalHealthEvent,
  opts: { deletedBy: string | null; reason: string | null; dosed: boolean }
): boolean {
  return db.transaction(() => {
    const review = db
      .select()
      .from(organicTreatmentReviews)
      .where(
        withTenant(organicTreatmentReviews, eq(organicTreatmentReviews.healthEventId, event.id))
      )
      .get();
    const organicReview: TombstoneOrganicReview | null = review
      ? {
          outcome: review.outcome,
          reason: review.reason,
          createdBy: review.createdBy ?? null,
          createdAt: review.createdAt.getTime(),
          lockedAt: review.lockedAt ? review.lockedAt.getTime() : null
        }
      : null;
    const removed =
      db
        .delete(animalHealthEvents)
        .where(withTenant(animalHealthEvents, eq(animalHealthEvents.id, event.id)))
        .run().changes > 0;
    if (!removed) return false;
    if (!opts.dosed) {
      db.delete(stockMovements)
        .where(
          withTenant(
            stockMovements,
            eq(stockMovements.reason, 'animal-treatment'),
            eq(stockMovements.notes, healthStockNote(event.id))
          )
        )
        .run();
    }
    db.insert(recordDeletions)
      .values(
        tenantValues({
          id: randomUUID(),
          recordKind: 'animal-health' as const,
          recordId: event.id,
          deletedBy: opts.deletedBy,
          reason: opts.reason,
          snapshotJson: JSON.stringify({ event, dosed: opts.dosed, organicReview })
        })
      )
      .run();
    return true;
  });
}

function parseTombstone(row: typeof recordDeletions.$inferSelect): HealthTombstone | null {
  let snap: unknown;
  try {
    snap = JSON.parse(row.snapshotJson);
  } catch {
    return null;
  }
  if (typeof snap !== 'object' || snap === null) return null;
  const s = snap as {
    event?: AnimalHealthEvent;
    dosed?: unknown;
    organicReview?: TombstoneOrganicReview | null;
  };
  if (!s.event || typeof s.event.subjectId !== 'string') return null;
  const review = s.organicReview;
  return {
    recordId: row.recordId,
    deletedAt: row.deletedAt.getTime(),
    deletedBy: row.deletedBy ?? null,
    reason: row.reason ?? null,
    dosed: s.dosed !== false,
    event: s.event,
    organicReview:
      review &&
      (review.outcome === 'status-lost' || review.outcome === 'not-affected') &&
      typeof review.reason === 'string'
        ? review
        : null
  };
}

/** Deleted health events of these subjects, for the hold they may keep. */
export function listHealthTombstones(subjects: readonly SubjectRef[]): HealthTombstone[] {
  if (subjects.length === 0) return [];
  const wanted = new Set(subjects.map((s) => `${s.subjectType}:${s.subjectId}`));
  return db
    .select()
    .from(recordDeletions)
    .where(withTenant(recordDeletions, eq(recordDeletions.recordKind, 'animal-health')))
    .all()
    .map(parseTombstone)
    .filter(
      (t): t is HealthTombstone =>
        t !== null && wanted.has(`${t.event.subjectType}:${t.event.subjectId}`)
    );
}

/** Every health event on the farm, for the hold ledger (C-35). */
export function listAllHealthEvents(): AnimalHealthEvent[] {
  return db
    .select()
    .from(animalHealthEvents)
    .where(withTenant(animalHealthEvents))
    .all()
    .map(rowTo);
}

/** Every deleted health event on the farm, for the hold ledger (C-35). */
export function listAllHealthTombstones(): HealthTombstone[] {
  return db
    .select()
    .from(recordDeletions)
    .where(withTenant(recordDeletions, eq(recordDeletions.recordKind, 'animal-health')))
    .all()
    .map(parseTombstone)
    .filter((t): t is HealthTombstone => t !== null);
}

/** Every animal that is or ever was in this group, from the current group
 *  column and the join and leave marks on location rows (C-15). */
export function listAnimalIdsEverInGroup(groupId: string): string[] {
  const current = db
    .select({ id: animals.id })
    .from(animals)
    .where(withTenant(animals, eq(animals.groupId, groupId)))
    .all()
    .map((r) => r.id);
  const linked = db
    .select({ id: animalLocations.subjectId })
    .from(animalLocations)
    .where(
      withTenant(
        animalLocations,
        eq(animalLocations.subjectType, 'animal'),
        or(eq(animalLocations.fromGroupId, groupId), eq(animalLocations.toGroupId, groupId))
      )
    )
    .all()
    .map((r) => r.id);
  return [...new Set([...current, ...linked])];
}
