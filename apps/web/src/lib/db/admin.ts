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

import { type SQL, and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { db } from './client';
import {
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
  insecticideEvents,
  pendingCalibrations,
  plantingRecords,
  soilTests,
  sprayEvents,
  sprayers,
  stockItems,
  stockLots,
  stockMovements,
  tasks
} from './schema';
import { type TenantScopedTable, withTenant } from './tenant';

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
}

export class RecordLockedError extends Error {
  constructor() {
    super('spray record is locked (FR-09); pass force=true (owner-only) to override');
    this.name = 'RecordLockedError';
  }
}

export function deleteSprayEvent(id: string, opts: DeleteSprayEventOptions = {}): DeleteSummary {
  const row = db
    .select()
    .from(sprayEvents)
    .where(withTenant(sprayEvents, eq(sprayEvents.id, id)))
    .get();
  if (!row) return { removed: {} };
  if (row.lockedAt && !opts.force) throw new RecordLockedError();
  const removed: Record<string, number> = {};
  removed.stock_movements = del(stockMovements, eq(stockMovements.sprayEventId, id));
  removed.spray_events = del(sprayEvents, eq(sprayEvents.id, id));
  return { removed };
}

// ─── Per-other-event ────────────────────────────────────────────────────

export function deleteHarvestEvent(id: string): DeleteSummary {
  return { removed: { harvest_events: del(harvestEvents, eq(harvestEvents.id, id)) } };
}

export function deleteInsecticideEvent(id: string): DeleteSummary {
  const removed: Record<string, number> = {};
  removed.stock_movements = del(stockMovements, eq(stockMovements.insecticideEventId, id));
  removed.insecticide_events = del(insecticideEvents, eq(insecticideEvents.id, id));
  return { removed };
}

export function deleteHayCutting(id: string): DeleteSummary {
  return { removed: { hay_cuttings: del(hayCuttings, eq(hayCuttings.id, id)) } };
}

export function deleteFertilityApplication(id: string): DeleteSummary {
  const removed: Record<string, number> = {};
  removed.stock_movements = del(stockMovements, eq(stockMovements.fertilityApplicationId, id));
  removed.fertility_applications = del(
    fertilityApplications,
    eq(fertilityApplications.id, id)
  );
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

export function deleteCropCascade(id: string): DeleteSummary {
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
  const fertilityIds = db
    .select({ id: fertilityApplications.id })
    .from(fertilityApplications)
    .where(withTenant(fertilityApplications, eq(fertilityApplications.cropId, id)))
    .all()
    .map((r) => r.id);

  if (sprayIds.length) {
    removed.stock_movements_spray = db
      .delete(stockMovements)
      .where(
        withTenant(stockMovements, inArray(stockMovements.sprayEventId, sprayIds))
      )
      .run().changes;
  }
  if (insecticideIds.length) {
    removed.stock_movements_insecticide = db
      .delete(stockMovements)
      .where(
        withTenant(
          stockMovements,
          inArray(stockMovements.insecticideEventId, insecticideIds)
        )
      )
      .run().changes;
  }
  if (fertilityIds.length) {
    removed.stock_movements_fertility = db
      .delete(stockMovements)
      .where(
        withTenant(
          stockMovements,
          inArray(stockMovements.fertilityApplicationId, fertilityIds)
        )
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

  removed.spray_events = del(sprayEvents, eq(sprayEvents.cropId, id));
  removed.insecticide_events = del(insecticideEvents, eq(insecticideEvents.cropId, id));
  removed.fertility_applications = del(
    fertilityApplications,
    eq(fertilityApplications.cropId, id)
  );
  removed.harvest_events = del(harvestEvents, eq(harvestEvents.cropId, id));
  removed.hay_cuttings = del(hayCuttings, eq(hayCuttings.cropId, id));

  removed.crops = del(crops, eq(crops.id, id));

  return { removed };
}

// ─── Per-block (the heaviest cascade) ───────────────────────────────────

export function deleteBlockCascade(id: string): DeleteSummary {
  const removed: Record<string, number> = {};

  const cropIds = db
    .select({ id: crops.id })
    .from(crops)
    .where(withTenant(crops, eq(crops.blockId, id)))
    .all()
    .map((r) => r.id);
  for (const cid of cropIds) {
    const r = deleteCropCascade(cid);
    for (const [k, v] of Object.entries(r.removed)) {
      removed[k] = (removed[k] ?? 0) + v;
    }
  }

  removed.spray_events_block = del(sprayEvents, eq(sprayEvents.blockId, id));
  removed.insecticide_events_block = del(insecticideEvents, eq(insecticideEvents.blockId, id));
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

export function deleteEquipmentCascade(id: string): DeleteSummary {
  const removed: Record<string, number> = {};
  removed.pending_calibrations = del(
    pendingCalibrations,
    eq(pendingCalibrations.equipmentId, id)
  );
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
  removed.fields = del(fields, eq(fields.id, id));
  return { removed };
}

// ─── Per-sprayer (legacy `sprayers` table) ─────────────────────────────

export function deleteSprayerCascade(id: string): DeleteSummary {
  const removed: Record<string, number> = {};
  const sprayIds = db
    .select({ id: sprayEvents.id })
    .from(sprayEvents)
    .where(withTenant(sprayEvents, eq(sprayEvents.sprayerId, id)))
    .all()
    .map((r) => r.id);
  if (sprayIds.length) {
    removed.stock_movements = db
      .delete(stockMovements)
      .where(withTenant(stockMovements, inArray(stockMovements.sprayEventId, sprayIds)))
      .run().changes;
  }
  removed.spray_events = del(sprayEvents, eq(sprayEvents.sprayerId, id));
  removed.sprayers = del(sprayers, eq(sprayers.id, id));
  return { removed };
}

// ─── Per-stock-item ─────────────────────────────────────────────────────

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
    .where(
      withTenant(fertilityApplications, eq(fertilityApplications.stockItemId, id))
    )
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

export function wipeAllData(opts: WipeOptions = {}): DeleteSummary {
  const removed: Record<string, number> = {};
  // Order: leaf rows first. Each `del(table, ...)` filters by active Owner.
  // The `isNotNull(table.id)` predicate is a tautology that lets the helper
  // run a tenant-scoped DELETE without a more specific filter.
  removed.stock_movements = del(stockMovements, isNotNull(stockMovements.id));
  removed.tasks = del(tasks, isNotNull(tasks.id));
  removed.crop_equipment = del(cropEquipment, isNotNull(cropEquipment.id));
  removed.spray_events = del(sprayEvents, isNotNull(sprayEvents.id));
  removed.harvest_events = del(harvestEvents, isNotNull(harvestEvents.id));
  removed.insecticide_events = del(insecticideEvents, isNotNull(insecticideEvents.id));
  removed.hay_cuttings = del(hayCuttings, isNotNull(hayCuttings.id));
  removed.fertility_applications = del(
    fertilityApplications,
    isNotNull(fertilityApplications.id)
  );
  removed.fertility_credits = del(fertilityCredits, isNotNull(fertilityCredits.id));
  removed.soil_tests = del(soilTests, isNotNull(soilTests.id));
  removed.pending_calibrations = del(
    pendingCalibrations,
    isNotNull(pendingCalibrations.id)
  );
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
 * Deletes only the *planning artifacts* — leaves blocks, fields, stock,
 * equipment, and historical (status='active'/'harvested'/etc.) crops
 * intact. Specifically targets:
 *
 *   - planting_records rows with status='planned' (the wizard's
 *     commit output before a planting actually goes in the ground)
 *   - crops rows with status='planned' (and their cascading events,
 *     though planned crops typically have none)
 *   - tasks tagged pluginTemplateKey='inputs-plan' AND status='open'
 *     (the Inputs Plan step's materialized tasks; completed ones
 *     stay so the executed history is preserved)
 *
 * Tenant-scoped via every del() helper. Returns a per-table count
 * the UI can surface in the confirmation result.
 */
export function wipeCurrentPlan(): DeleteSummary {
  const removed: Record<string, number> = {};

  // 1. Planned crops + their (rarely-present) cascading events.
  const plannedCropIds = db
    .select({ id: crops.id })
    .from(crops)
    .where(withTenant(crops, eq(crops.status, 'planned')))
    .all()
    .map((r) => r.id);
  for (const cid of plannedCropIds) {
    const r = deleteCropCascade(cid);
    for (const [k, v] of Object.entries(r.removed)) {
      removed[k] = (removed[k] ?? 0) + v;
    }
  }

  // 2. Planning records with status='planned' — the wizard's commit
  //    output before a planting goes in the ground.
  removed.planting_records_planned = del(
    plantingRecords,
    eq(plantingRecords.status, 'planned')
  );

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

