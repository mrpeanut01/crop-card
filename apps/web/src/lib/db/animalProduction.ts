import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { db } from './client';
import { animalProductionLogs, recordDeletions } from './schema';
import { tenantValues, withTenant } from './tenant';
import { LOCK_WINDOW_MS } from './recordKinds';
import type { AnimalSubjectType } from '$lib/animals/model';
import type { ProductionKind } from '$lib/animals/recordApiSchemas';
import { GATED_USES, type ProductionUse } from '$lib/safety/animalWithdrawal';

export interface AnimalProductionLog {
  id: string;
  subjectType: AnimalSubjectType;
  subjectId: string;
  kind: ProductionKind;
  quantity: number;
  unit: string;
  occurredAt: number;
  use: ProductionUse;
  /** C-06: food or sale if the log was ever saved that way. */
  declaredUse: DeclaredUse | null;
  rulesVersion: string | null;
  performedById: string | null;
  clientRecordId: string | null;
  lockedAt: number | null;
  /** C-35: saved more than 48 hours after it was collected. */
  recordedLate?: boolean;
  createdAt: number;
}

export type DeclaredUse = 'food' | 'sale';

function declaredAfter(previous: DeclaredUse | null, use: ProductionUse): DeclaredUse | null {
  if (previous) return previous;
  return (GATED_USES as readonly ProductionUse[]).includes(use) ? (use as DeclaredUse) : null;
}

/** C-06: the use the "tell the buyer" rule reads. A log once saved as food
 *  or for sale keeps that reading after a change to discard or unknown. */
export function declaredFoodUse(
  log: Pick<AnimalProductionLog, 'use' | 'declaredUse'>
): ProductionUse {
  if ((GATED_USES as readonly ProductionUse[]).includes(log.use)) return log.use;
  return log.declaredUse ?? log.use;
}

type Row = typeof animalProductionLogs.$inferSelect;

function rowTo(row: Row): AnimalProductionLog {
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    kind: row.kind,
    quantity: row.quantity,
    unit: row.unit,
    occurredAt: row.occurredAt.getTime(),
    use: row.use,
    declaredUse: row.declaredUse ?? null,
    rulesVersion: row.rulesVersion ?? null,
    performedById: row.performedById ?? null,
    clientRecordId: row.clientRecordId ?? null,
    lockedAt: row.lockedAt ? row.lockedAt.getTime() : null,
    recordedLate: row.recordedLate,
    createdAt: row.createdAt.getTime()
  };
}

export function insertProductionLog(input: {
  subjectType: AnimalSubjectType;
  subjectId: string;
  kind: ProductionKind;
  quantity: number;
  unit: string;
  occurredAt: number;
  use: ProductionUse;
  rulesVersion: string;
  performedById: string | null;
  clientRecordId?: string | null;
  createdAt?: number;
}): AnimalProductionLog {
  return rowTo(
    db
      .insert(animalProductionLogs)
      .values(
        tenantValues({
          id: randomUUID(),
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          kind: input.kind,
          quantity: input.quantity,
          unit: input.unit,
          occurredAt: new Date(input.occurredAt),
          use: input.use,
          declaredUse: declaredAfter(null, input.use),
          rulesVersion: input.rulesVersion,
          performedById: input.performedById,
          clientRecordId: input.clientRecordId ?? null,
          recordedLate: input.occurredAt < (input.createdAt ?? Date.now()) - LOCK_WINDOW_MS,
          createdAt: new Date(input.createdAt ?? Date.now())
        })
      )
      .returning()
      .get()
  );
}

export function getProductionLog(id: string): AnimalProductionLog | undefined {
  const row = db
    .select()
    .from(animalProductionLogs)
    .where(withTenant(animalProductionLogs, eq(animalProductionLogs.id, id)))
    .get();
  return row ? rowTo(row) : undefined;
}

/** One subject's logs, newest first. */
export function listProductionLogs(
  subjectType: AnimalSubjectType,
  subjectId: string,
  limit = 100
): AnimalProductionLog[] {
  return db
    .select()
    .from(animalProductionLogs)
    .where(
      withTenant(
        animalProductionLogs,
        eq(animalProductionLogs.subjectType, subjectType),
        eq(animalProductionLogs.subjectId, subjectId)
      )
    )
    .orderBy(desc(animalProductionLogs.occurredAt), desc(animalProductionLogs.createdAt))
    .limit(limit)
    .all()
    .map(rowTo);
}

/** Saved eggs and milk declared as food or sale on these subjects, now or
 *  before a later change of use (C-06). */
export function listFoodLogsForSubjects(
  subjects: readonly { subjectType: AnimalSubjectType; subjectId: string }[]
): AnimalProductionLog[] {
  const out: AnimalProductionLog[] = [];
  for (const type of ['animal', 'group'] as const) {
    const ids = [
      ...new Set(subjects.filter((s) => s.subjectType === type).map((s) => s.subjectId))
    ];
    if (ids.length === 0) continue;
    out.push(
      ...db
        .select()
        .from(animalProductionLogs)
        .where(
          withTenant(
            animalProductionLogs,
            and(
              eq(animalProductionLogs.subjectType, type),
              inArray(animalProductionLogs.subjectId, ids),
              or(
                inArray(animalProductionLogs.use, ['food', 'sale']),
                isNotNull(animalProductionLogs.declaredUse)
              ),
              inArray(animalProductionLogs.kind, ['eggs', 'milk'])
            )
          )
        )
        .all()
        .map(rowTo)
    );
  }
  return out;
}

/** FR-09 for a food-producing subject's logs (C-07), stamped once. */
export function evaluateProductionLock(
  log: AnimalProductionLog,
  foodProducing: boolean,
  now = Date.now()
): number | undefined {
  if (log.lockedAt) return log.lockedAt;
  if (!foodProducing) return undefined;
  if (now - log.occurredAt < LOCK_WINDOW_MS) return undefined;
  const lockedAt = log.occurredAt + LOCK_WINDOW_MS;
  db.update(animalProductionLogs)
    .set({ lockedAt: new Date(lockedAt) })
    .where(withTenant(animalProductionLogs, eq(animalProductionLogs.id, log.id)))
    .run();
  return lockedAt;
}

function writeAudit(
  log: AnimalProductionLog,
  opts: { by: string | null; reason: string | null; snapshot: unknown }
): void {
  db.insert(recordDeletions)
    .values(
      tenantValues({
        id: randomUUID(),
        recordKind: 'animal-production' as const,
        recordId: log.id,
        deletedBy: opts.by,
        reason: opts.reason,
        snapshotJson: JSON.stringify(opts.snapshot)
      })
    )
    .run();
}

/** Changes a log's use, keeping the previous value in the record trail. */
export function setProductionUse(
  log: AnimalProductionLog,
  use: ProductionUse,
  opts: { by: string | null; reason: string | null; rulesVersion: string }
): AnimalProductionLog | undefined {
  return db.transaction(() => {
    const row = db
      .update(animalProductionLogs)
      .set({
        use,
        declaredUse: declaredAfter(log.declaredUse, use),
        rulesVersion: opts.rulesVersion
      })
      .where(withTenant(animalProductionLogs, eq(animalProductionLogs.id, log.id)))
      .returning()
      .get();
    if (!row) return undefined;
    writeAudit(log, {
      by: opts.by,
      reason: opts.reason ?? `Use changed from ${log.use} to ${use}`,
      snapshot: { action: 'use-change', before: log, use }
    });
    return rowTo(row);
  });
}

/** Deletes a log. A locked one leaves a tombstone. */
export function deleteProductionLog(
  log: AnimalProductionLog,
  opts: { by: string | null; reason: string | null; tombstone: boolean }
): boolean {
  return db.transaction(() => {
    const removed =
      db
        .delete(animalProductionLogs)
        .where(withTenant(animalProductionLogs, eq(animalProductionLogs.id, log.id)))
        .run().changes > 0;
    if (removed && opts.tombstone) {
      writeAudit(log, { by: opts.by, reason: opts.reason, snapshot: { action: 'delete', log } });
    }
    return removed;
  });
}

/** Every production log on the farm, for the hold ledger (C-35). */
export function listAllProductionLogs(): AnimalProductionLog[] {
  return db
    .select()
    .from(animalProductionLogs)
    .where(withTenant(animalProductionLogs))
    .all()
    .map(rowTo);
}

/** Deleted production logs on the farm (their tombstones), for the hold
 *  ledger: a food or sale log a hold covered stays covered (C-06, C-35). */
export function listDeletedProductionLogs(): AnimalProductionLog[] {
  const out: AnimalProductionLog[] = [];
  for (const row of db
    .select()
    .from(recordDeletions)
    .where(withTenant(recordDeletions, eq(recordDeletions.recordKind, 'animal-production')))
    .all()) {
    let snap: unknown;
    try {
      snap = JSON.parse(row.snapshotJson);
    } catch {
      continue;
    }
    const s = snap as { action?: string; log?: AnimalProductionLog } | null;
    if (!s || s.action !== 'delete' || !s.log || typeof s.log.occurredAt !== 'number') continue;
    out.push(s.log);
  }
  return out;
}
