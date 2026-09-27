import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { db } from './client';
import { animalStatusEvents } from './schema';
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
  lockedAt: number | null;
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
    lockedAt: row.lockedAt ? row.lockedAt.getTime() : null,
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

export function deleteStatusEvent(id: string): boolean {
  return (
    db
      .delete(animalStatusEvents)
      .where(withTenant(animalStatusEvents, eq(animalStatusEvents.id, id)))
      .run().changes > 0
  );
}
