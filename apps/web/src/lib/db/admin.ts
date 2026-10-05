/**
 * Admin / cleanup operations (Phase 12E).
 *
 * Centralizes the cascade logic for hard deletes. The data model has
 * several tables that FK into others; deleting a parent without first
 * removing its dependents would leave orphan rows (SQLite doesn't enforce
 * FKs by default in this app). These helpers walk the dependency graph
 * in the correct order.
 *
 * Phase 18a: tenant-scoped. Every cascade only walks rows owned by the
 * active Owner. `wipeAllData()` wipes only the active tenant — superadmin
 * cross-tenant wipes are an explicit, audited operation defined elsewhere.
 */

import { randomUUID } from 'node:crypto';
import { type SQL, and, eq, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { db } from './client';
import { plantingInGround } from '$lib/garden/inGround';
import {
  amendmentBatchInputs,
  amendmentBatches,
  amendmentBioassays,
  amendmentDismissals,
  blobDeletions,
  documentLinks,
  documents,
  forageTests,
  harvestDispositions,
  organicStatusEvents,
  organicTreatmentReviews,
  animalCarePlans,
  animalFlagChanges,
  holdCorrections,
  animalGroups,
  animalHealthEvents,
  animalLocations,
  animalProductionLogs,
  animalStatusEvents,
  animals,
  blockProtections,
  blocks,
  cropEquipment,
  crops,
  equipment,
  equipmentLog,
  equipmentState,
  fertilityApplications,
  fertilityCredits,
  fields,
  hayCuttings,
  harvestEvents,
  fungicideEvents,
  grazingAttestations,
  insecticideEvents,
  irrigationEvents,
  ledgerEntries,
  ledgerEntryChanges,
  mapFeatureAreas,
  mapFeatures,
  pendingCalibrations,
  rainGaugeReadings,
  recordDeletions,
  scoutObservations,
  seedStarts,
  soilTests,
  sprayEvents,
  sprayers,
  stockItems,
  stockLots,
  stockMovements,
  taskTimeEntries,
  tasks
} from './schema';
import {
  type TenantScopedTable,
  requireOwnerId,
  tenantValues,
  unscopedQueryNote,
  withTenant
} from './tenant';
import { ownerStoragePrefix } from './documents';
import { unlinkMapFeaturesFromField } from './mapFeatures';
import { liveHoldParams } from './holdParams';
import { LOCK_WINDOW_MS } from './recordKinds';
import { evaluateLock as evaluateSprayLock, getSprayEvent } from './sprayEvents';
import { evaluateLock as evaluateInsecticideLock, getInsecticideEvent } from './insecticideEvents';
import { evaluateLock as evaluateFungicideLock, getFungicideEvent } from './fungicideEvents';
import { evaluateLock as evaluateHarvestLock, getHarvestEvent } from './harvestEvents';
import {
  evaluateDispositionLock,
  getHarvestDisposition,
  listDispositionsForHarvests
} from './harvestDispositions';

export interface DeleteSummary {
  /** Per-table row counts that were removed. Surfaces in the response so
   *  the operator can verify the cascade did what they expected. */
  removed: Record<string, number>;
}

/** Internal helper — runs a tenant-scoped DELETE and returns the change
 *  count. Tenant filter is auto-added to whatever where clause the caller
 *  passes. */
function del<T extends TenantScopedTable>(table: T, where: SQL): number {
  const r = db
    .delete(table as SQLiteTable)
    .where(withTenant(table, where))
    .run();
  return r.changes;
}

// ─── Per-spray-event ────────────────────────────────────────────────────

export interface DeleteSprayEventOptions {
  force?: boolean;
  /** #329 — acting user + reason recorded on the force-delete tombstone. */
  deletedBy?: string;
  reason?: string;
  /** Phase 32C: write a tombstone even for an unlocked record, so the
   *  grazing and hay holds of the application survive the delete (C-26). */
  tombstone?: boolean;
  /** The owner says the product was never applied, so its holds drop. */
  neverApplied?: boolean;
}

export class RecordLockedError extends Error {
  constructor(
    kind: 'spray' | 'insecticide' | 'fungicide' | 'harvest' | 'harvest-disposition' = 'spray'
  ) {
    super(`${kind} record is locked (FR-09); pass force=true (owner-only) to override`);
    this.name = 'RecordLockedError';
  }
}

/**
 * #329 — write a tombstone before a force-delete removes a locked record.
 * The row is gone after the delete, so the snapshot + acting user + reason
 * are the only surviving trace. Tenant-scoped via `tenantValues`.
 */
function writeDeletionTombstone(
  kind: 'spray' | 'insecticide' | 'fungicide' | 'harvest' | 'harvest-disposition',
  recordId: string,
  snapshot: unknown,
  opts: {
    deletedBy?: string;
    reason?: string;
    neverApplied?: boolean;
    /** The Area of a block deleted with this record (see `deleteBlockCascade`). */
    deletedFromFieldId?: string | null;
  }
): void {
  if (opts.neverApplied && snapshot && typeof snapshot === 'object') {
    snapshot = { ...snapshot, neverApplied: true };
  }
  if (opts.deletedFromFieldId && snapshot && typeof snapshot === 'object') {
    snapshot = { ...snapshot, deletedFromFieldId: opts.deletedFromFieldId };
  }
  if (
    kind !== 'harvest' &&
    kind !== 'harvest-disposition' &&
    snapshot &&
    typeof snapshot === 'object'
  ) {
    const holdParamsJson = liveHoldParams(kind, recordId);
    if (holdParamsJson) snapshot = { ...snapshot, holdParamsJson };
  }
  db.insert(recordDeletions)
    .values(
      tenantValues({
        id: randomUUID(),
        recordKind: kind,
        recordId,
        deletedBy: opts.deletedBy ?? null,
        reason: opts.reason ?? null,
        snapshotJson: JSON.stringify(snapshot ?? null)
      })
    )
    .run();
}

export interface ApplicationTombstone {
  source: 'spray' | 'insecticide' | 'fungicide';
  id: string;
  blockId: string;
  occurredAt: number;
  products: Array<{ pluginId?: string | null; displayName?: string }>;
  /** Set when the application's block was deleted: the Area the block was
   *  in. The ground is still there, so the application still counts on
   *  that Area (review round 4). */
  formerFieldId?: string;
}

/**
 * Phase 32C (C-26): deleted herbicide, insecticide and fungicide
 * applications that still count for grazing and hay holds. Only an owner's
 * "never applied" delete drops one.
 */
export function listApplicationTombstones(fromMs: number): ApplicationTombstone[] {
  const rows = db
    .select()
    .from(recordDeletions)
    .where(
      withTenant(
        recordDeletions,
        inArray(recordDeletions.recordKind, ['spray', 'insecticide', 'fungicide'])
      )
    )
    .all();
  const out: ApplicationTombstone[] = [];
  for (const row of rows) {
    let snap: unknown;
    try {
      snap = JSON.parse(row.snapshotJson);
    } catch {
      continue;
    }
    if (!snap || typeof snap !== 'object') continue;
    const e = snap as Record<string, unknown>;
    if (e.neverApplied === true) continue;
    if (typeof e.blockId !== 'string' || typeof e.occurredAt !== 'number') continue;
    if (e.occurredAt < fromMs) continue;
    out.push({
      source: row.recordKind as ApplicationTombstone['source'],
      id: row.recordId,
      blockId: e.blockId,
      occurredAt: e.occurredAt,
      products: Array.isArray(e.products) ? (e.products as ApplicationTombstone['products']) : [],
      ...(typeof e.deletedFromFieldId === 'string' ? { formerFieldId: e.deletedFromFieldId } : {})
    });
  }
  return out;
}

export function deleteSprayEvent(id: string, opts: DeleteSprayEventOptions = {}): DeleteSummary {
  const event = getSprayEvent(id);
  if (!event) return { removed: {} };
  // evaluateLock stamps + returns the lock time for any row past the 48h
  // window, including aged rows that were never read (the #308 class of
  // bug where a never-stamped lockedAt let old records delete freely).
  const lockedAt = evaluateSprayLock(event);
  if (lockedAt !== undefined) {
    if (!opts.force) throw new RecordLockedError('spray');
    writeDeletionTombstone('spray', id, event, opts);
  } else if (opts.tombstone) {
    writeDeletionTombstone('spray', id, event, opts);
  }
  const removed: Record<string, number> = {};
  removed.stock_movements = del(stockMovements, eq(stockMovements.sprayEventId, id));
  removed.spray_events = del(sprayEvents, eq(sprayEvents.id, id));
  return { removed };
}

// ─── Per-other-event ────────────────────────────────────────────────────

export function deleteHarvestEvent(id: string, opts: DeleteSprayEventOptions = {}): DeleteSummary {
  const event = getHarvestEvent(id);
  if (!event) return { removed: {} };
  const lockedAt = evaluateHarvestLock(event);
  if (lockedAt !== undefined) {
    if (!opts.force) throw new RecordLockedError('harvest');
    writeDeletionTombstone('harvest', id, event, opts);
  }
  return { removed: { harvest_events: del(harvestEvents, eq(harvestEvents.id, id)) } };
}

/**
 * Phase 33B (B-29, B-35): removes one disposition. Inside its 48-hour window
 * it goes with no trace, as harvests do; after it, only `force` (the owner,
 * checked by the route) removes it and a tombstone keeps the snapshot.
 * @hold-exempt: dispositions never change a hold (O-13)
 */
export function deleteHarvestDisposition(
  id: string,
  opts: { force?: boolean; deletedBy?: string; reason?: string } = {}
): DeleteSummary {
  const d = getHarvestDisposition(id);
  if (!d) return { removed: {} };
  const lockedAt = evaluateDispositionLock(d);
  if (lockedAt !== undefined) {
    if (!opts.force) throw new RecordLockedError('harvest-disposition');
    writeDeletionTombstone('harvest-disposition', id, { ...d, lockedAt }, opts);
  }
  return {
    removed: { harvest_dispositions: del(harvestDispositions, eq(harvestDispositions.id, id)) }
  };
}

/** B-30: the dispositions of harvests a planting or block delete removes go
 *  first, explicitly, so a locked one leaves a tombstone instead of
 *  vanishing through the SQL cascade (which also does nothing while foreign
 *  keys are off). */
function deleteDispositionsOfHarvests(harvestIds: string[], reason: string): number {
  if (harvestIds.length === 0) return 0;
  let removed = 0;
  for (const list of listDispositionsForHarvests(harvestIds).values()) {
    for (const d of list) {
      const lockedAt = evaluateDispositionLock(d);
      if (lockedAt !== undefined) {
        writeDeletionTombstone('harvest-disposition', d.id, { ...d, lockedAt }, { reason });
      }
      removed += del(harvestDispositions, eq(harvestDispositions.id, d.id));
    }
  }
  return removed;
}

function harvestIdsWhere(where: SQL): string[] {
  return db
    .select({ id: harvestEvents.id })
    .from(harvestEvents)
    .where(withTenant(harvestEvents, where))
    .all()
    .map((r) => r.id);
}

export function deleteInsecticideEvent(
  id: string,
  opts: DeleteSprayEventOptions = {}
): DeleteSummary {
  const event = getInsecticideEvent(id);
  if (!event) return { removed: {} };
  const lockedAt = evaluateInsecticideLock(event);
  if (lockedAt !== undefined) {
    if (!opts.force) throw new RecordLockedError('insecticide');
    writeDeletionTombstone('insecticide', id, event, opts);
  } else if (opts.tombstone) {
    writeDeletionTombstone('insecticide', id, event, opts);
  }
  const removed: Record<string, number> = {};
  removed.stock_movements = del(stockMovements, eq(stockMovements.insecticideEventId, id));
  removed.insecticide_events = del(insecticideEvents, eq(insecticideEvents.id, id));
  return { removed };
}

/** 32G G4-04: a mirror of `deleteInsecticideEvent`, used only by the
 *  owner's fungicide void. */
export function deleteFungicideEvent(
  id: string,
  opts: DeleteSprayEventOptions = {}
): DeleteSummary {
  const event = getFungicideEvent(id);
  if (!event) return { removed: {} };
  const lockedAt = evaluateFungicideLock(event);
  if (lockedAt !== undefined) {
    if (!opts.force) throw new RecordLockedError('fungicide');
    writeDeletionTombstone('fungicide', id, event, opts);
  } else if (opts.tombstone) {
    writeDeletionTombstone('fungicide', id, event, opts);
  }
  const removed: Record<string, number> = {};
  removed.stock_movements = del(stockMovements, eq(stockMovements.fungicideEventId, id));
  removed.fungicide_events = del(fungicideEvents, eq(fungicideEvents.id, id));
  return { removed };
}

export function deleteHayCutting(id: string): DeleteSummary {
  return { removed: { hay_cuttings: del(hayCuttings, eq(hayCuttings.id, id)) } };
}

export function deleteFertilityApplication(id: string): DeleteSummary {
  const removed: Record<string, number> = {};
  removed.stock_movements = del(stockMovements, eq(stockMovements.fertilityApplicationId, id));
  removed.fertility_applications = del(fertilityApplications, eq(fertilityApplications.id, id));
  return { removed };
}

export function deleteFertilityCredit(id: string): DeleteSummary {
  return { removed: { fertility_credits: del(fertilityCredits, eq(fertilityCredits.id, id)) } };
}

export function deleteSoilTest(id: string): DeleteSummary {
  return { removed: { soil_tests: del(soilTests, eq(soilTests.id, id)) } };
}

// ─── Per-task ───────────────────────────────────────────────────────────

export function deleteTask(id: string): DeleteSummary {
  const removed: Record<string, number> = {};
  removed.tasks_linked = del(tasks, eq(tasks.linkedToTaskId, id));
  removed.tasks = del(tasks, eq(tasks.id, id));
  return { removed };
}

// ─── Per-crop (cascades through every event tied to that planting) ──────

export function deleteCropCascade(
  id: string,
  opts: { deletedFromFieldId?: string | null } = {}
): DeleteSummary {
  const removed: Record<string, number> = {};

  const sprayIds = db
    .select({ id: sprayEvents.id })
    .from(sprayEvents)
    .where(withTenant(sprayEvents, eq(sprayEvents.cropId, id)))
    .all()
    .map((r) => r.id);
  const insecticideIds = db
    .select({ id: insecticideEvents.id })
    .from(insecticideEvents)
    .where(withTenant(insecticideEvents, eq(insecticideEvents.cropId, id)))
    .all()
    .map((r) => r.id);
  const fungicideIds = db
    .select({ id: fungicideEvents.id })
    .from(fungicideEvents)
    .where(withTenant(fungicideEvents, eq(fungicideEvents.cropId, id)))
    .all()
    .map((r) => r.id);
  const fertilityIds = db
    .select({ id: fertilityApplications.id })
    .from(fertilityApplications)
    .where(withTenant(fertilityApplications, eq(fertilityApplications.cropId, id)))
    .all()
    .map((r) => r.id);

  if (sprayIds.length) {
    removed.stock_movements_spray = db
      .delete(stockMovements)
      .where(withTenant(stockMovements, inArray(stockMovements.sprayEventId, sprayIds)))
      .run().changes;
  }
  if (insecticideIds.length) {
    removed.stock_movements_insecticide = db
      .delete(stockMovements)
      .where(withTenant(stockMovements, inArray(stockMovements.insecticideEventId, insecticideIds)))
      .run().changes;
  }
  if (fungicideIds.length) {
    removed.stock_movements_fungicide = db
      .delete(stockMovements)
      .where(withTenant(stockMovements, inArray(stockMovements.fungicideEventId, fungicideIds)))
      .run().changes;
  }
  if (fertilityIds.length) {
    removed.stock_movements_fertility = db
      .delete(stockMovements)
      .where(
        withTenant(stockMovements, inArray(stockMovements.fertilityApplicationId, fertilityIds))
      )
      .run().changes;
  }
  removed.stock_movements_crop = del(stockMovements, eq(stockMovements.cropId, id));

  const taskIds = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(withTenant(tasks, eq(tasks.cropId, id)))
    .all()
    .map((r) => r.id);
  if (taskIds.length) {
    removed.tasks_linked = db
      .delete(tasks)
      .where(withTenant(tasks, inArray(tasks.linkedToTaskId, taskIds)))
      .run().changes;
  }
  removed.tasks = del(tasks, eq(tasks.cropId, id));

  removed.crop_equipment = del(cropEquipment, eq(cropEquipment.cropId, id));

  for (const sid of sprayIds) {
    const e = getSprayEvent(sid);
    if (e) {
      writeDeletionTombstone('spray', sid, e, {
        reason: 'planting deleted',
        deletedFromFieldId: opts.deletedFromFieldId
      });
    }
  }
  for (const iid of insecticideIds) {
    const e = getInsecticideEvent(iid);
    if (e) {
      writeDeletionTombstone('insecticide', iid, e, {
        reason: 'planting deleted',
        deletedFromFieldId: opts.deletedFromFieldId
      });
    }
  }
  for (const fid of fungicideIds) {
    const e = getFungicideEvent(fid);
    if (e) {
      writeDeletionTombstone('fungicide', fid, e, {
        reason: 'planting deleted',
        deletedFromFieldId: opts.deletedFromFieldId
      });
    }
  }
  removed.spray_events = del(sprayEvents, eq(sprayEvents.cropId, id));
  removed.insecticide_events = del(insecticideEvents, eq(insecticideEvents.cropId, id));
  removed.fungicide_events = del(fungicideEvents, eq(fungicideEvents.cropId, id));
  removed.scout_observations = del(scoutObservations, eq(scoutObservations.cropId, id));
  removed.fertility_applications = del(fertilityApplications, eq(fertilityApplications.cropId, id));
  removed.harvest_dispositions = deleteDispositionsOfHarvests(
    harvestIdsWhere(eq(harvestEvents.cropId, id)),
    'planting deleted'
  );
  removed.harvest_events = del(harvestEvents, eq(harvestEvents.cropId, id));
  removed.hay_cuttings = del(hayCuttings, eq(hayCuttings.cropId, id));
  removed.seed_starts = del(seedStarts, eq(seedStarts.cropId, id));

  removed.crops = del(crops, eq(crops.id, id));

  return { removed };
}

/** FR-09 / Invariant 5: whether deleting this planting would destroy a
 *  record already past its 48-hour lock (a spray, insecticide, fungicide,
 *  harvest or hay cutting dated 48 hours or more ago). */
export function cropHasLockedRecords(id: string, nowMs: number = Date.now()): boolean {
  const cutoff = new Date(nowMs - LOCK_WINDOW_MS);
  const any = <T extends TenantScopedTable>(table: T, where: SQL | undefined): boolean =>
    db
      .select()
      .from(table as SQLiteTable)
      .where(withTenant(table, where))
      .limit(1)
      .all().length > 0;
  return (
    any(sprayEvents, and(eq(sprayEvents.cropId, id), lte(sprayEvents.occurredAt, cutoff))) ||
    any(
      insecticideEvents,
      and(eq(insecticideEvents.cropId, id), lte(insecticideEvents.occurredAt, cutoff))
    ) ||
    any(
      fungicideEvents,
      and(eq(fungicideEvents.cropId, id), lte(fungicideEvents.occurredAt, cutoff))
    ) ||
    any(harvestEvents, and(eq(harvestEvents.cropId, id), lte(harvestEvents.occurredAt, cutoff))) ||
    any(
      hayCuttings,
      and(
        eq(hayCuttings.cropId, id),
        or(lte(hayCuttings.mowAt, cutoff), lte(hayCuttings.createdAt, cutoff))
      )
    )
  );
}

// ─── Per-block (the heaviest cascade) ───────────────────────────────────

/** True when a block holds anything beyond plans: a planting already in the
 *  ground (see `plantingInGround`), any spray, harvest, hay, fertility or
 *  soil record, or a task that is not one of its plans' own. The garden
 *  designer only deletes beds for which this is false. */
export function blockHasRecords(id: string, nowMs: number = Date.now()): boolean {
  const cropRows = db
    .select({
      id: crops.id,
      status: crops.status,
      plantingDate: crops.plantingDate,
      harvestedAt: crops.harvestedAt
    })
    .from(crops)
    .where(withTenant(crops, eq(crops.blockId, id)))
    .all();
  const inGround = (c: (typeof cropRows)[number]) =>
    plantingInGround(
      {
        status: c.status,
        plantingDateMs: c.plantingDate?.getTime() ?? null,
        harvestedAtMs: c.harvestedAt?.getTime() ?? null
      },
      nowMs
    );
  if (cropRows.some(inGround)) return true;
  const plannedIds = new Set(cropRows.map((c) => c.id));
  const any = <T extends TenantScopedTable>(table: T, where: SQL): boolean =>
    db
      .select()
      .from(table as SQLiteTable)
      .where(withTenant(table, where))
      .limit(1)
      .all().length > 0;
  if (
    any(sprayEvents, eq(sprayEvents.blockId, id)) ||
    any(insecticideEvents, eq(insecticideEvents.blockId, id)) ||
    any(fungicideEvents, eq(fungicideEvents.blockId, id)) ||
    any(harvestEvents, eq(harvestEvents.blockId, id)) ||
    any(hayCuttings, eq(hayCuttings.blockId, id)) ||
    any(fertilityApplications, eq(fertilityApplications.blockId, id)) ||
    any(fertilityCredits, eq(fertilityCredits.blockId, id)) ||
    any(soilTests, eq(soilTests.blockId, id))
  ) {
    return true;
  }
  const taskRows = db
    .select({ cropId: tasks.cropId })
    .from(tasks)
    .where(withTenant(tasks, eq(tasks.blockId, id)))
    .all();
  return taskRows.some((t) => !t.cropId || !plannedIds.has(t.cropId));
}

/**
 * Applications deleted before their block (a spray or planting delete) were
 * tombstoned while the block still placed them on its Area. Once the block
 * goes too, the tombstone is all that places them, so it gets the block's
 * Area now (review round 5).
 */
function placeEarlierTombstones(blockId: string, fieldId: string): void {
  const rows = db
    .select({ id: recordDeletions.id, json: recordDeletions.snapshotJson })
    .from(recordDeletions)
    .where(
      withTenant(
        recordDeletions,
        inArray(recordDeletions.recordKind, ['spray', 'insecticide', 'fungicide'])
      )
    )
    .all();
  for (const row of rows) {
    let snap: unknown;
    try {
      snap = JSON.parse(row.json);
    } catch {
      continue;
    }
    if (!snap || typeof snap !== 'object') continue;
    const e = snap as Record<string, unknown>;
    if (e.blockId !== blockId || e.deletedFromFieldId === fieldId) continue;
    db.update(recordDeletions)
      .set({ snapshotJson: JSON.stringify({ ...e, deletedFromFieldId: fieldId }) })
      .where(withTenant(recordDeletions, eq(recordDeletions.id, row.id)))
      .run();
  }
}

export function deleteBlockCascade(id: string): DeleteSummary {
  const removed: Record<string, number> = {};
  // Deleting a block removes its record, not its ground: every spray and
  // insecticide on it keeps a tombstone naming the Area it was in, so the
  // grazing rules still count it there (review round 4).
  const deletedFromFieldId =
    db
      .select({ fieldId: blocks.fieldId })
      .from(blocks)
      .where(withTenant(blocks, eq(blocks.id, id)))
      .get()?.fieldId ?? null;

  if (deletedFromFieldId) placeEarlierTombstones(id, deletedFromFieldId);

  const cropIds = db
    .select({ id: crops.id })
    .from(crops)
    .where(withTenant(crops, eq(crops.blockId, id)))
    .all()
    .map((r) => r.id);
  for (const cid of cropIds) {
    const r = deleteCropCascade(cid, { deletedFromFieldId });
    for (const [k, v] of Object.entries(r.removed)) {
      removed[k] = (removed[k] ?? 0) + v;
    }
  }

  const blockSprayIds = db
    .select({ id: sprayEvents.id })
    .from(sprayEvents)
    .where(withTenant(sprayEvents, eq(sprayEvents.blockId, id)))
    .all()
    .map((r) => r.id);
  const blockInsecticideIds = db
    .select({ id: insecticideEvents.id })
    .from(insecticideEvents)
    .where(withTenant(insecticideEvents, eq(insecticideEvents.blockId, id)))
    .all()
    .map((r) => r.id);
  const blockFungicideIds = db
    .select({ id: fungicideEvents.id })
    .from(fungicideEvents)
    .where(withTenant(fungicideEvents, eq(fungicideEvents.blockId, id)))
    .all()
    .map((r) => r.id);
  for (const fid of blockFungicideIds) {
    const e = getFungicideEvent(fid);
    if (e) {
      writeDeletionTombstone('fungicide', fid, e, { reason: 'block deleted', deletedFromFieldId });
    }
  }
  if (blockFungicideIds.length) {
    removed.stock_movements_block_fungicide = db
      .delete(stockMovements)
      .where(
        withTenant(stockMovements, inArray(stockMovements.fungicideEventId, blockFungicideIds))
      )
      .run().changes;
  }
  for (const sid of blockSprayIds) {
    const e = getSprayEvent(sid);
    if (e) {
      writeDeletionTombstone('spray', sid, e, { reason: 'block deleted', deletedFromFieldId });
    }
  }
  for (const iid of blockInsecticideIds) {
    const e = getInsecticideEvent(iid);
    if (e) {
      writeDeletionTombstone('insecticide', iid, e, {
        reason: 'block deleted',
        deletedFromFieldId
      });
    }
  }
  if (blockSprayIds.length) {
    removed.stock_movements_block_spray = db
      .delete(stockMovements)
      .where(withTenant(stockMovements, inArray(stockMovements.sprayEventId, blockSprayIds)))
      .run().changes;
  }
  if (blockInsecticideIds.length) {
    removed.stock_movements_block_insecticide = db
      .delete(stockMovements)
      .where(
        withTenant(stockMovements, inArray(stockMovements.insecticideEventId, blockInsecticideIds))
      )
      .run().changes;
  }

  removed.spray_events_block = del(sprayEvents, eq(sprayEvents.blockId, id));
  removed.insecticide_events_block = del(insecticideEvents, eq(insecticideEvents.blockId, id));
  removed.fungicide_events_block = del(fungicideEvents, eq(fungicideEvents.blockId, id));
  removed.scout_observations_block = del(scoutObservations, eq(scoutObservations.blockId, id));
  removed.harvest_dispositions_block = deleteDispositionsOfHarvests(
    harvestIdsWhere(eq(harvestEvents.blockId, id)),
    'block deleted'
  );
  removed.harvest_events_block = del(harvestEvents, eq(harvestEvents.blockId, id));
  removed.hay_cuttings_block = del(hayCuttings, eq(hayCuttings.blockId, id));
  removed.fertility_applications_block = del(
    fertilityApplications,
    eq(fertilityApplications.blockId, id)
  );
  removed.fertility_credits = del(fertilityCredits, eq(fertilityCredits.blockId, id));
  removed.soil_tests = del(soilTests, eq(soilTests.blockId, id));

  removed.block_tasks = del(tasks, eq(tasks.blockId, id));

  removed.blocks = del(blocks, eq(blocks.id, id));
  return { removed };
}

// ─── Per-equipment ──────────────────────────────────────────────────────

/** Herbicide spray records name their sprayer and the column cannot be
 *  cleared, so a sprayer they name cannot be deleted (retire it instead). */
export function equipmentHasSprayRecords(id: string): boolean {
  return (
    db
      .select({ id: sprayEvents.id })
      .from(sprayEvents)
      .where(withTenant(sprayEvents, eq(sprayEvents.sprayerId, id)))
      .limit(1)
      .all().length > 0
  );
}

/** @hold-exempt: only clears the sprayer link on insecticide and fungicide records; no hold reads it */
export function deleteEquipmentCascade(id: string): DeleteSummary {
  const removed: Record<string, number> = {};
  removed.pending_calibrations = del(pendingCalibrations, eq(pendingCalibrations.equipmentId, id));
  removed.equipment_log = del(equipmentLog, eq(equipmentLog.equipmentId, id));
  removed.equipment_state = del(equipmentState, eq(equipmentState.equipmentId, id));
  removed.crop_equipment = del(cropEquipment, eq(cropEquipment.equipmentId, id));
  db.update(tasks)
    .set({ equipmentId: null })
    .where(withTenant(tasks, eq(tasks.equipmentId, id)))
    .run();
  db.update(insecticideEvents)
    .set({ sprayerId: null })
    .where(withTenant(insecticideEvents, eq(insecticideEvents.sprayerId, id)))
    .run();
  db.update(fungicideEvents)
    .set({ sprayerId: null })
    .where(withTenant(fungicideEvents, eq(fungicideEvents.sprayerId, id)))
    .run();
  removed.equipment = del(equipment, eq(equipment.id, id));
  return { removed };
}

// ─── Per-field (Phase 13) ───────────────────────────────────────────────

export function deleteFieldCascade(id: string): DeleteSummary {
  const removed: Record<string, number> = {};
  const blockIds = db
    .select({ id: blocks.id })
    .from(blocks)
    .where(withTenant(blocks, eq(blocks.fieldId, id)))
    .all()
    .map((r) => r.id);
  for (const bid of blockIds) {
    const r = deleteBlockCascade(bid);
    for (const [k, v] of Object.entries(r.removed)) {
      removed[k] = (removed[k] ?? 0) + v;
    }
  }
  unlinkMapFeaturesFromField(id);
  removed.animal_locations = del(animalLocations, eq(animalLocations.fieldId, id));
  removed.fields = del(fields, eq(fields.id, id));
  return { removed };
}

// ─── Per-sprayer (legacy `sprayers` table) ─────────────────────────────

/** Spray records carry the FR-09 lock, the grazing and hay holds (C-19,
 *  C-26) and the tombstone rule, so they are only removed one at a time
 *  through the spray-record delete. This returns how many reference the id
 *  (`spray_events.sprayer_id` points at `equipment`, so an equipment id
 *  finds them). */
export function countSprayEventsForSprayer(id: string): number {
  return db
    .select({ id: sprayEvents.id })
    .from(sprayEvents)
    .where(withTenant(sprayEvents, eq(sprayEvents.sprayerId, id)))
    .all().length;
}

/** Removes a legacy `sprayers` row. Never touches spray records. */
export function deleteSprayerCascade(id: string): DeleteSummary {
  const removed: Record<string, number> = {};
  removed.sprayers = del(sprayers, eq(sprayers.id, id));
  return { removed };
}

// ─── Per-stock-item ─────────────────────────────────────────────────────

/** @hold-exempt: only clears the stock link on health records; holds read the product, not the bottle */
export function deleteStockItemCascade(id: string): DeleteSummary {
  const removed: Record<string, number> = {};
  const lotIds = db
    .select({ id: stockLots.id })
    .from(stockLots)
    .where(withTenant(stockLots, eq(stockLots.stockItemId, id)))
    .all()
    .map((r) => r.id);
  if (lotIds.length) {
    removed.stock_movements = db
      .delete(stockMovements)
      .where(withTenant(stockMovements, inArray(stockMovements.stockLotId, lotIds)))
      .run().changes;
  }
  removed.stock_lots = del(stockLots, eq(stockLots.stockItemId, id));
  db.update(fertilityApplications)
    .set({ stockItemId: null })
    .where(withTenant(fertilityApplications, eq(fertilityApplications.stockItemId, id)))
    .run();
  db.update(animalHealthEvents)
    .set({ stockItemId: null })
    .where(withTenant(animalHealthEvents, eq(animalHealthEvents.stockItemId, id)))
    .run();
  removed.stock_items = del(stockItems, eq(stockItems.id, id));
  return { removed };
}

export function deleteStockLotCascade(id: string): DeleteSummary {
  const removed: Record<string, number> = {};
  removed.stock_movements = del(stockMovements, eq(stockMovements.stockLotId, id));
  removed.stock_lots = del(stockLots, eq(stockLots.id, id));
  return { removed };
}

// ─── Wipe everything except users + plugins (the latter are filesystem) ─
//
// Tenant-scoped: only wipes the current Owner's rows. Cross-tenant wipes
// are a separate superadmin operation that goes through superadmin_audit.
// `weather_forecast_cache` is intentionally NOT wiped — it's a global
// shared cache keyed by lat/lon and contains no tenant data.

export interface WipeOptions {
  /** Keep equipment templates / sprayer rows (the user's calibration setup).
   *  Default false — full reset. */
  keepEquipment?: boolean;
  /** Accepted for back-compat with /api/admin/wipe payloads; no-op after
   *  Phase 18a because `weather_forecast_cache` is a globally-shared,
   *  lat/lon-keyed cache with no tenant data — wipeAllData no longer
   *  touches it regardless of this flag. Tracked in CLAUDE.md follow-ups
   *  for eventual removal once API callers stop sending it. */
  keepWeatherCache?: boolean;
}

/** A-13: the rows and the queued prefix delete land together, so files are
 *  unreachable at once and maintenance removes the bytes (V-13). */
function wipeDocuments(): Record<string, number> {
  const ownerId = requireOwnerId();
  return db.transaction(() => {
    unscopedQueryNote('blob deletion queue');
    db.insert(blobDeletions)
      .values({ storagePrefix: ownerStoragePrefix(ownerId) })
      .onConflictDoNothing()
      .run();
    return {
      document_links: del(documentLinks, isNotNull(documentLinks.id)),
      documents: del(documents, isNotNull(documents.id))
    };
  });
}

/** @hold-exempt: the owner wipes the whole farm, every record with it (GDPR erase) */
export function wipeAllData(opts: WipeOptions = {}): DeleteSummary {
  const removed: Record<string, number> = {};
  // Order: leaf rows first. Each `del(table, ...)` filters by active Owner.
  // The `isNotNull(table.id)` predicate is a tautology that lets the helper
  // run a tenant-scoped DELETE without a more specific filter.
  removed.harvest_dispositions = del(harvestDispositions, isNotNull(harvestDispositions.id));
  removed.organic_treatment_reviews = del(
    organicTreatmentReviews,
    isNotNull(organicTreatmentReviews.id)
  );
  removed.organic_status_events = del(organicStatusEvents, isNotNull(organicStatusEvents.id));
  removed.amendment_dismissals = del(amendmentDismissals, isNotNull(amendmentDismissals.id));
  removed.amendment_bioassays = del(amendmentBioassays, isNotNull(amendmentBioassays.id));
  removed.amendment_batch_inputs = del(amendmentBatchInputs, isNotNull(amendmentBatchInputs.id));
  removed.amendment_batches = del(amendmentBatches, isNotNull(amendmentBatches.id));
  removed.forage_tests = del(forageTests, isNotNull(forageTests.id));
  Object.assign(removed, wipeDocuments());
  removed.ledger_entry_changes = del(ledgerEntryChanges, isNotNull(ledgerEntryChanges.id));
  removed.ledger_entries = del(ledgerEntries, isNotNull(ledgerEntries.id));
  removed.task_time_entries = del(taskTimeEntries, isNotNull(taskTimeEntries.id));
  removed.animal_care_plans = del(animalCarePlans, isNotNull(animalCarePlans.id));
  removed.animal_health_events = del(animalHealthEvents, isNotNull(animalHealthEvents.id));
  removed.animal_production_logs = del(animalProductionLogs, isNotNull(animalProductionLogs.id));
  removed.animal_status_events = del(animalStatusEvents, isNotNull(animalStatusEvents.id));
  removed.animal_flag_changes = del(animalFlagChanges, isNotNull(animalFlagChanges.id));
  removed.hold_corrections = del(holdCorrections, isNotNull(holdCorrections.id));
  removed.animal_locations = del(animalLocations, isNotNull(animalLocations.id));
  removed.grazing_attestations = del(grazingAttestations, isNotNull(grazingAttestations.id));
  removed.animals = del(animals, isNotNull(animals.id));
  removed.animal_groups = del(animalGroups, isNotNull(animalGroups.id));
  removed.seed_starts = del(seedStarts, isNotNull(seedStarts.id));
  removed.block_protections = del(blockProtections, isNotNull(blockProtections.id));
  removed.irrigation_events = del(irrigationEvents, isNotNull(irrigationEvents.id));
  removed.rain_gauge_readings = del(rainGaugeReadings, isNotNull(rainGaugeReadings.id));
  removed.stock_movements = del(stockMovements, isNotNull(stockMovements.id));
  removed.tasks = del(tasks, isNotNull(tasks.id));
  removed.crop_equipment = del(cropEquipment, isNotNull(cropEquipment.id));
  removed.spray_events = del(sprayEvents, isNotNull(sprayEvents.id));
  removed.harvest_events = del(harvestEvents, isNotNull(harvestEvents.id));
  removed.insecticide_events = del(insecticideEvents, isNotNull(insecticideEvents.id));
  removed.hay_cuttings = del(hayCuttings, isNotNull(hayCuttings.id));
  removed.fertility_applications = del(fertilityApplications, isNotNull(fertilityApplications.id));
  removed.fertility_credits = del(fertilityCredits, isNotNull(fertilityCredits.id));
  removed.soil_tests = del(soilTests, isNotNull(soilTests.id));
  removed.pending_calibrations = del(pendingCalibrations, isNotNull(pendingCalibrations.id));
  removed.stock_lots = del(stockLots, isNotNull(stockLots.id));
  removed.stock_items = del(stockItems, isNotNull(stockItems.id));
  removed.crops = del(crops, isNotNull(crops.id));
  if (!opts.keepEquipment) {
    removed.equipment_log = del(equipmentLog, isNotNull(equipmentLog.id));
    removed.equipment_state = del(equipmentState, isNotNull(equipmentState.equipmentId));
    removed.equipment = del(equipment, isNotNull(equipment.id));
    removed.sprayers = del(sprayers, isNotNull(sprayers.id));
  }
  removed.blocks = del(blocks, isNotNull(blocks.id));
  removed.map_feature_areas = del(mapFeatureAreas, isNotNull(mapFeatureAreas.featureId));
  removed.map_features = del(mapFeatures, isNotNull(mapFeatures.id));
  removed.fields = del(fields, isNotNull(fields.id));
  // Null out any orphan task.linkedToTaskId references (rare but possible
  // if a partial delete left dangling pointers). Tenant-scoped.
  db.update(tasks)
    .set({ linkedToTaskId: null })
    .where(withTenant(tasks, and(isNotNull(tasks.linkedToTaskId))!))
    .run();
  return { removed };
}

/**
 * Phase 21 (B-28 follow-up) — "Start over" reset for the Plan wizard.
 *
 * Deletes the *current plan* — every crop that's still purely a
 * planning artifact: status IN ('planned', 'active') AND no real-
 * world events tied to it (no sprays, insecticide applications,
 * fungicide applications, fertility applications, harvest events, or
 * hay cuttings). Once a crop has been worked on it's part of the
 * audit trail and survives the reset.
 *
 * Why not filter on plantingDate?
 *   First attempt used "future or null plantingDate" as the signal
 *   for "still in the plan." But the AI scheduler picks dates
 *   relative to frost windows for the whole season, so some
 *   plantings end up scheduled for the recent past (e.g. early-
 *   April lettuce committed in mid-May) without the operator
 *   actually having planted them. Date-based filters wrongly
 *   excluded those rows. "Has the operator done anything with this
 *   crop yet?" — i.e. event-presence — is the right signal.
 *
 * Specifically targets:
 *
 *   - crops with status IN ('planned', 'active') AND no rows in any
 *     of: spray_events, insecticide_events, fungicide_events,
 *     fertility_applications, harvest_events, hay_cuttings
 *   - tasks tagged pluginTemplateKey='inputs-plan' AND status='open'
 *     (completed/aborted tasks survive — executed history stays)
 *
 * Tenant-scoped via every del() helper. Returns a per-table count
 * the UI can surface in the confirmation result.
 *
 * Note: `plantingRecords` from schema.ts is an alias for `crops` —
 * the wizard's addPlanting() writes to the same table. We only need
 * one pass.
 * @hold-exempt: removes only plantings with no spray, harvest or hay record
 */
export function wipeCurrentPlan(): DeleteSummary {
  const removed: Record<string, number> = {};

  // 1. Collect crop IDs that already have events — those are "real"
  //    and must survive the reset regardless of status.
  const protectedCropIds = new Set<string>();
  const eventTables = [
    sprayEvents,
    insecticideEvents,
    harvestEvents,
    fertilityApplications,
    hayCuttings
  ] as const;
  for (const table of eventTables) {
    const rows = db
      .select({ cropId: table.cropId })
      .from(table)
      .where(withTenant(table, isNotNull(table.cropId)))
      .all();
    for (const r of rows) if (r.cropId) protectedCropIds.add(r.cropId);
  }
  // Fungicide events live on a separate table that's been added
  // post-B-18; checked separately so the import list reads cleanly.
  {
    const rows = db
      .select({ cropId: fungicideEvents.cropId })
      .from(fungicideEvents)
      .where(withTenant(fungicideEvents, isNotNull(fungicideEvents.cropId)))
      .all();
    for (const r of rows) if (r.cropId) protectedCropIds.add(r.cropId);
  }

  // 2. Find every crop in the candidate-for-wipe bucket: planning
  //    statuses, minus the event-protected set.
  const planRowIds = db
    .select({ id: crops.id })
    .from(crops)
    .where(withTenant(crops, inArray(crops.status, ['planned', 'active'])))
    .all()
    .map((r) => r.id)
    .filter((id) => !protectedCropIds.has(id));

  for (const cid of planRowIds) {
    const r = deleteCropCascade(cid);
    for (const [k, v] of Object.entries(r.removed)) {
      removed[k] = (removed[k] ?? 0) + v;
    }
  }
  removed.crops_current_plan = planRowIds.length;

  // 3. Open inputs-plan tasks. Completed / aborted tasks survive —
  //    their executed history is load-bearing for the audit trail.
  removed.tasks_inputs_plan_open = db
    .delete(tasks)
    .where(
      withTenant(
        tasks,
        and(
          eq(tasks.pluginTemplateKey, 'inputs-plan'),
          isNull(tasks.completedAt),
          isNull(tasks.abortedAt)
        )!
      )
    )
    .run().changes;

  return { removed };
}
