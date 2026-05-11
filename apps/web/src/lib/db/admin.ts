/**
 * Admin / cleanup operations (Phase 12E).
 *
 * Centralizes the cascade logic for hard deletes. The data model has
 * several tables that FK into others; deleting a parent without first
 * removing its dependents would leave orphan rows (SQLite doesn't enforce
 * FKs by default in this app). These helpers walk the dependency graph
 * in the correct order.
 *
 * Used both by per-entity DELETE endpoints (block, crop, equipment, stock
 * item, spray-event, etc.) and by the `wipeAllData()` reset used during
 * testing to "start from step zero" without resetting the schema or the
 * plugin registry.
 */

import { eq, inArray, isNotNull } from 'drizzle-orm';
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
  soilTests,
  sprayEvents,
  sprayers,
  stockItems,
  stockLots,
  stockMovements,
  tasks,
  weatherForecastCache
} from './schema';

export interface DeleteSummary {
  /** Per-table row counts that were removed. Surfaces in the response so
   *  the operator can verify the cascade did what they expected. */
  removed: Record<string, number>;
}

/** Internal helper — runs a DELETE and returns the change count. */
function del(table: Parameters<typeof db.delete>[0], where: ReturnType<typeof eq>): number {
  const r = db.delete(table).where(where).run();
  return r.changes;
}

// ─── Per-spray-event ────────────────────────────────────────────────────

export interface DeleteSprayEventOptions {
  /** When false (default), refuse to delete a locked record (FR-09 48-hour
   *  immutability). Owner-role + an explicit force=true override is the
   *  only path past the lock. */
  force?: boolean;
}

export class RecordLockedError extends Error {
  constructor() {
    super('spray record is locked (FR-09); pass force=true (owner-only) to override');
    this.name = 'RecordLockedError';
  }
}

export function deleteSprayEvent(id: string, opts: DeleteSprayEventOptions = {}): DeleteSummary {
  const row = db.select().from(sprayEvents).where(eq(sprayEvents.id, id)).get();
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
  // Cascade to pre/post-tasks linked to this primary.
  removed.tasks_linked = del(tasks, eq(tasks.linkedToTaskId, id));
  removed.tasks = del(tasks, eq(tasks.id, id));
  return { removed };
}

// ─── Per-crop (cascades through every event tied to that planting) ──────

// TODO(phase-15-bug): user reported that deleting a crop from the Schedule
// tab also wiped the navigation "Plan" tile / overall plan state. Repro
// hypothesis: this cascade may be removing rows another page reads as a
// presence signal (e.g., last surviving crop on a block hides the Plan tab,
// or a blocks/fields delete chains through here unexpectedly). Needs a
// deterministic repro before fixing — see docs/clickthrough-reports/ when
// next investigated.
export function deleteCropCascade(id: string): DeleteSummary {
  const removed: Record<string, number> = {};

  // 1. Find dependent events first so we can clear stock_movements that
  //    point at them.
  const sprayIds = db
    .select({ id: sprayEvents.id })
    .from(sprayEvents)
    .where(eq(sprayEvents.cropId, id))
    .all()
    .map((r) => r.id);
  const insecticideIds = db
    .select({ id: insecticideEvents.id })
    .from(insecticideEvents)
    .where(eq(insecticideEvents.cropId, id))
    .all()
    .map((r) => r.id);
  const fertilityIds = db
    .select({ id: fertilityApplications.id })
    .from(fertilityApplications)
    .where(eq(fertilityApplications.cropId, id))
    .all()
    .map((r) => r.id);

  // 2. Delete stock movements pointing at these events OR directly at the crop
  //    (Phase 13: movements may carry cropId without an event link).
  if (sprayIds.length) {
    removed.stock_movements_spray = db
      .delete(stockMovements)
      .where(inArray(stockMovements.sprayEventId, sprayIds))
      .run().changes;
  }
  if (insecticideIds.length) {
    removed.stock_movements_insecticide = db
      .delete(stockMovements)
      .where(inArray(stockMovements.insecticideEventId, insecticideIds))
      .run().changes;
  }
  if (fertilityIds.length) {
    removed.stock_movements_fertility = db
      .delete(stockMovements)
      .where(inArray(stockMovements.fertilityApplicationId, fertilityIds))
      .run().changes;
  }
  removed.stock_movements_crop = del(stockMovements, eq(stockMovements.cropId, id));

  // 3. Delete tasks tied to this crop (and their pre/post-tasks).
  const taskIds = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.cropId, id))
    .all()
    .map((r) => r.id);
  if (taskIds.length) {
    removed.tasks_linked = db
      .delete(tasks)
      .where(inArray(tasks.linkedToTaskId, taskIds))
      .run().changes;
  }
  removed.tasks = del(tasks, eq(tasks.cropId, id));

  // 3a. Drop crop ↔ equipment bindings (Phase 13).
  removed.crop_equipment = del(cropEquipment, eq(cropEquipment.cropId, id));

  // 4. Delete the events themselves.
  removed.spray_events = del(sprayEvents, eq(sprayEvents.cropId, id));
  removed.insecticide_events = del(insecticideEvents, eq(insecticideEvents.cropId, id));
  removed.fertility_applications = del(fertilityApplications, eq(fertilityApplications.cropId, id));
  removed.harvest_events = del(harvestEvents, eq(harvestEvents.cropId, id));
  removed.hay_cuttings = del(hayCuttings, eq(hayCuttings.cropId, id));

  // 5. Finally, the crop row itself.
  removed.crops = del(crops, eq(crops.id, id));

  return { removed };
}

// ─── Per-block (the heaviest cascade) ───────────────────────────────────

export function deleteBlockCascade(id: string): DeleteSummary {
  const removed: Record<string, number> = {};

  // Crops on this block first — that cascades through their events.
  const cropIds = db
    .select({ id: crops.id })
    .from(crops)
    .where(eq(crops.blockId, id))
    .all()
    .map((r) => r.id);
  for (const cid of cropIds) {
    const r = deleteCropCascade(cid);
    for (const [k, v] of Object.entries(r.removed)) {
      removed[k] = (removed[k] ?? 0) + v;
    }
  }

  // Events that have a blockId but no cropId (legacy / pre-Phase 12 rows).
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

  // Tasks tied to the block (no specific crop).
  removed.block_tasks = del(tasks, eq(tasks.blockId, id));

  // The block itself.
  removed.blocks = del(blocks, eq(blocks.id, id));
  return { removed };
}

// ─── Per-equipment ──────────────────────────────────────────────────────

export function deleteEquipmentCascade(id: string): DeleteSummary {
  const removed: Record<string, number> = {};
  removed.pending_calibrations = del(pendingCalibrations, eq(pendingCalibrations.equipmentId, id));
  removed.equipment_log = del(equipmentLog, eq(equipmentLog.equipmentId, id));
  removed.equipment_state = del(equipmentState, eq(equipmentState.equipmentId, id));
  // Phase 13: drop any per-crop bindings.
  removed.crop_equipment = del(cropEquipment, eq(cropEquipment.equipmentId, id));
  // tasks.equipment_id is nullable; null it out instead of deleting tasks.
  db.update(tasks).set({ equipmentId: null }).where(eq(tasks.equipmentId, id)).run();
  // insecticide_events.sprayerId references equipment(id) but is nullable; null it.
  db.update(insecticideEvents)
    .set({ sprayerId: null })
    .where(eq(insecticideEvents.sprayerId, id))
    .run();
  removed.equipment = del(equipment, eq(equipment.id, id));
  return { removed };
}

// ─── Per-field (Phase 13) ───────────────────────────────────────────────

/**
 * Cascade through every block in this field, then every crop and every
 * event tied to those blocks. The block walker reuses deleteBlockCascade
 * so the heavy lifting stays in one place.
 */
export function deleteFieldCascade(id: string): DeleteSummary {
  const removed: Record<string, number> = {};
  const blockIds = db
    .select({ id: blocks.id })
    .from(blocks)
    .where(eq(blocks.fieldId, id))
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
  // spray_events.sprayer_id references sprayers; we cascade-delete those.
  const sprayIds = db
    .select({ id: sprayEvents.id })
    .from(sprayEvents)
    .where(eq(sprayEvents.sprayerId, id))
    .all()
    .map((r) => r.id);
  if (sprayIds.length) {
    removed.stock_movements = db
      .delete(stockMovements)
      .where(inArray(stockMovements.sprayEventId, sprayIds))
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
    .where(eq(stockLots.stockItemId, id))
    .all()
    .map((r) => r.id);
  if (lotIds.length) {
    removed.stock_movements = db
      .delete(stockMovements)
      .where(inArray(stockMovements.stockLotId, lotIds))
      .run().changes;
  }
  removed.stock_lots = del(stockLots, eq(stockLots.stockItemId, id));
  // fertility_applications.stockItemId is nullable — null it out.
  db.update(fertilityApplications)
    .set({ stockItemId: null })
    .where(eq(fertilityApplications.stockItemId, id))
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

export interface WipeOptions {
  /** Keep the weather-forecast cache (no farm data). Default true. */
  keepWeatherCache?: boolean;
  /** Keep equipment templates / sprayer rows (the user's calibration setup).
   *  Default false — full reset. */
  keepEquipment?: boolean;
}

export function wipeAllData(opts: WipeOptions = {}): DeleteSummary {
  const removed: Record<string, number> = {};
  // Order: leaf rows first.
  removed.stock_movements = db.delete(stockMovements).run().changes;
  removed.tasks = db.delete(tasks).run().changes;
  removed.crop_equipment = db.delete(cropEquipment).run().changes;
  removed.spray_events = db.delete(sprayEvents).run().changes;
  removed.harvest_events = db.delete(harvestEvents).run().changes;
  removed.insecticide_events = db.delete(insecticideEvents).run().changes;
  removed.hay_cuttings = db.delete(hayCuttings).run().changes;
  removed.fertility_applications = db.delete(fertilityApplications).run().changes;
  removed.fertility_credits = db.delete(fertilityCredits).run().changes;
  removed.soil_tests = db.delete(soilTests).run().changes;
  removed.pending_calibrations = db.delete(pendingCalibrations).run().changes;
  removed.stock_lots = db.delete(stockLots).run().changes;
  removed.stock_items = db.delete(stockItems).run().changes;
  removed.crops = db.delete(crops).run().changes;
  if (!opts.keepEquipment) {
    removed.equipment_log = db.delete(equipmentLog).run().changes;
    removed.equipment_state = db.delete(equipmentState).run().changes;
    removed.equipment = db.delete(equipment).run().changes;
    removed.sprayers = db.delete(sprayers).run().changes;
  }
  removed.blocks = db.delete(blocks).run().changes;
  removed.fields = db.delete(fields).run().changes;
  if (!opts.keepWeatherCache) {
    removed.weather_forecast_cache = db.delete(weatherForecastCache).run().changes;
  }
  // Filter out any nullable ALTER updates we don't track.
  db.update(tasks).set({ linkedToTaskId: null }).where(isNotNull(tasks.linkedToTaskId)).run();
  return { removed };
}
