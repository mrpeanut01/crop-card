import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from './client';
import { animalStatusEvents, recordDeletions } from './schema';
import { tenantValues, withTenant } from './tenant';
import { LOCK_WINDOW_MS } from './recordKinds';
import type { AnimalSubjectType, StatusEventStatus } from '$lib/animals/model';

export interface AnimalStatusEvent {
  id: string;
  subjectType: AnimalSubjectType;
  subjectId: string;
  status: (typeof animalStatusEvents.$inferSelect)['status'];
  occurredAt: number;
  reason: string | null;
  headCountDelta: number | null;
  recordedById: string | null;
  clientRecordId: string | null;
  rulesVersion: string | null;
  lockedAt: number | null;
  /** C-35: saved more than 48 hours after it happened. */
  recordedLate?: boolean;
  createdAt: number;
}

type StatusRow = typeof animalStatusEvents.$inferSelect;

function rowToEvent(row: StatusRow): AnimalStatusEvent {
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    status: row.status,
    occurredAt: row.occurredAt.getTime(),
    reason: row.reason ?? null,
    headCountDelta: row.headCountDelta ?? null,
    recordedById: row.recordedById ?? null,
    clientRecordId: row.clientRecordId ?? null,
    rulesVersion: row.rulesVersion ?? null,
    lockedAt: row.lockedAt ? row.lockedAt.getTime() : null,
    recordedLate: row.recordedLate,
    createdAt: row.createdAt.getTime()
  };
}

/** A subject's status history, oldest first. */
export function listStatusEvents(
  subjectType: AnimalSubjectType,
  subjectId: string
): AnimalStatusEvent[] {
  return db
    .select()
    .from(animalStatusEvents)
    .where(
      withTenant(
        animalStatusEvents,
        eq(animalStatusEvents.subjectType, subjectType),
        eq(animalStatusEvents.subjectId, subjectId)
      )
    )
    .orderBy(asc(animalStatusEvents.occurredAt), asc(animalStatusEvents.createdAt))
    .all()
    .map(rowToEvent);
}

/** Status changes of these subjects, oldest first. */
export function listStatusEventsForSubjects(
  subjects: readonly { subjectType: AnimalSubjectType; subjectId: string }[]
): AnimalStatusEvent[] {
  const out: AnimalStatusEvent[] = [];
  for (const type of ['animal', 'group'] as const) {
    const ids = [
      ...new Set(subjects.filter((s) => s.subjectType === type).map((s) => s.subjectId))
    ];
    if (ids.length === 0) continue;
    out.push(
      ...db
        .select()
        .from(animalStatusEvents)
        .where(
          withTenant(
            animalStatusEvents,
            and(
              eq(animalStatusEvents.subjectType, type),
              inArray(animalStatusEvents.subjectId, ids)
            )
          )
        )
        .all()
        .map(rowToEvent)
    );
  }
  return out.sort((a, b) => a.occurredAt - b.occurredAt || a.createdAt - b.createdAt);
}

export function getStatusEvent(id: string): AnimalStatusEvent | undefined {
  const row = db
    .select()
    .from(animalStatusEvents)
    .where(withTenant(animalStatusEvents, eq(animalStatusEvents.id, id)))
    .get();
  return row ? rowToEvent(row) : undefined;
}

export function insertStatusEvent(input: {
  subjectType: AnimalSubjectType;
  subjectId: string;
  status: StatusEventStatus;
  occurredAt: number;
  reason?: string | null;
  headCountDelta?: number | null;
  recordedById: string | null;
  clientRecordId?: string | null;
  createdAt?: number;
  /** Set when the food gate ran on this change. */
  rulesVersion?: string | null;
}): AnimalStatusEvent {
  return rowToEvent(
    db
      .insert(animalStatusEvents)
      .values(
        tenantValues({
          id: randomUUID(),
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          status: input.status,
          occurredAt: new Date(input.occurredAt),
          reason: input.reason?.trim() || null,
          headCountDelta: input.headCountDelta ?? null,
          recordedById: input.recordedById,
          clientRecordId: input.clientRecordId ?? null,
          rulesVersion: input.rulesVersion ?? null,
          recordedLate: input.occurredAt < (input.createdAt ?? Date.now()) - LOCK_WINDOW_MS,
          ...(input.createdAt !== undefined ? { createdAt: new Date(input.createdAt) } : {})
        })
      )
      .returning()
      .get()
  );
}

/** FR-09 for animal status changes: a food-producing subject's event locks
 *  48 h after it happened and the lock is stamped once. Pets stay editable.
 *  Returns the lock time, or undefined while the event can still change. */
export function evaluateStatusLock(
  event: AnimalStatusEvent,
  foodProducing: boolean,
  now = Date.now()
): number | undefined {
  if (event.lockedAt) return event.lockedAt;
  if (!foodProducing) return undefined;
  if (now - event.occurredAt < LOCK_WINDOW_MS) return undefined;
  const lockedAt = event.occurredAt + LOCK_WINDOW_MS;
  db.update(animalStatusEvents)
    .set({ lockedAt: new Date(lockedAt) })
    .where(withTenant(animalStatusEvents, eq(animalStatusEvents.id, event.id)))
    .run();
  return lockedAt;
}

/** Removes a status change, leaving a tombstone (C-35): a slaughter or
 *  sale for meat a hold covered stays covered after an undo. */
export function deleteStatusEvent(id: string, deletedBy: string | null = null): boolean {
  const event = getStatusEvent(id);
  const removed =
    db
      .delete(animalStatusEvents)
      .where(withTenant(animalStatusEvents, eq(animalStatusEvents.id, id)))
      .run().changes > 0;
  if (removed && event) {
    db.insert(recordDeletions)
      .values(
        tenantValues({
          id: randomUUID(),
          recordKind: 'animal-status' as const,
          recordId: id,
          deletedBy,
          reason: 'Undone',
          snapshotJson: JSON.stringify({ action: 'undo', event })
        })
      )
      .run();
  }
  return removed;
}

/** Every status change on the farm, for the hold ledger (C-35). */
export function listAllStatusEvents(): AnimalStatusEvent[] {
  return db
    .select()
    .from(animalStatusEvents)
    .where(withTenant(animalStatusEvents))
    .orderBy(asc(animalStatusEvents.occurredAt), asc(animalStatusEvents.createdAt))
    .all()
    .map(rowToEvent);
}

/** Undone status changes, for the hold ledger's covered set (C-35). */
export function listUndoneStatusEvents(): AnimalStatusEvent[] {
  const out: AnimalStatusEvent[] = [];
  for (const row of db
    .select()
    .from(recordDeletions)
    .where(withTenant(recordDeletions, eq(recordDeletions.recordKind, 'animal-status')))
    .all()) {
    let snap: unknown;
    try {
      snap = JSON.parse(row.snapshotJson);
    } catch {
      continue;
    }
    const e = (snap as { event?: AnimalStatusEvent } | null)?.event;
    if (!e || typeof e.occurredAt !== 'number' || typeof e.subjectId !== 'string') continue;
    out.push(e);
  }
  return out;
}
