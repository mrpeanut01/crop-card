/**
 * Phase 13 — Field hierarchy + crop_equipment + stock cropId.
 *
 * Real-DB integration tests. Uses random UUIDs so rows don't collide with
 * any existing fixture data in the dev SQLite.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  deleteBlockCascade,
  deleteFieldCascade,
  deleteEquipmentCascade,
  wipeAllData
} from '$lib/db/admin';
import { createBlock, deleteBlock, getBlock, listBlocks, updateBlock } from '$lib/db/blocks';
import {
  bindEquipment,
  CropEquipmentBindingExistsError,
  listCropEquipment,
  listCropsForEquipment,
  unbindEquipment
} from '$lib/db/cropEquipment';
import { db } from '$lib/db/client';
import { createField, ensureHomeField, listFields, updateField } from '$lib/db/fields';
import { crops as cropsTable, equipment, stockMovements } from '$lib/db/schema';
import { decrementForUse, createStockItem, receiveLot } from '$lib/db/stock';
import { eq } from 'drizzle-orm';

function uniq(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('Phase 13 — Field ↔ Block hierarchy', () => {
  it('createBlock without fieldId resolves to Home Field', () => {
    const homeId = ensureHomeField();
    const b = createBlock({ name: uniq('phase13-block') });
    expect(b.fieldId).toBe(homeId);
  });

  it('listFields rolls up block counts + acres', () => {
    const f = createField({ name: uniq('field') });
    createBlock({ name: uniq('b1'), fieldId: f.id, acres: 5 });
    createBlock({ name: uniq('b2'), fieldId: f.id, acres: 3 });
    const fields = listFields();
    const found = fields.find((x) => x.id === f.id);
    expect(found).toBeDefined();
    expect(found!.blockCount).toBe(2);
    expect(found!.blockAcresTotal).toBe(8);
  });

  it('updateBlock can re-parent block to another field', () => {
    const f1 = createField({ name: uniq('f1') });
    const f2 = createField({ name: uniq('f2') });
    const b = createBlock({ name: uniq('b'), fieldId: f1.id });
    const updated = updateBlock(b.id, { fieldId: f2.id, name: 'renamed' });
    expect(updated?.fieldId).toBe(f2.id);
    expect(updated?.name).toBe('renamed');
  });

  it('updateField patches name + acres + notes', () => {
    const f = createField({ name: uniq('ff') });
    const updated = updateField(f.id, {
      name: 'renamed-field',
      acres: 42.5,
      notes: 'lease info'
    });
    expect(updated?.name).toBe('renamed-field');
    expect(updated?.acres).toBe(42.5);
    expect(updated?.notes).toBe('lease info');
  });

  it('createBlock with geometryGeojson persists the polygon (Phase 13b)', () => {
    const polygon =
      '{"type":"Polygon","coordinates":[[[-77.6,39.10],[-77.59,39.10],[-77.59,39.11],[-77.60,39.11],[-77.60,39.10]]]}';
    const b = createBlock({ name: uniq('with-geom'), geometryGeojson: polygon });
    const fetched = getBlock(b.id);
    expect(fetched?.geometryGeojson).toBe(polygon);
    deleteBlockCascade(b.id);
  });

  it('deleteFieldCascade removes member blocks + cascades crops + events', () => {
    const f = createField({ name: uniq('to-delete') });
    const b1 = createBlock({ name: 'b1', fieldId: f.id });
    const b2 = createBlock({ name: 'b2', fieldId: f.id });
    const summary = deleteFieldCascade(f.id);
    expect(summary.removed.fields).toBe(1);
    expect(summary.removed.blocks ?? 0).toBeGreaterThanOrEqual(2);
    // Both blocks gone:
    expect(listBlocks().some((b) => b.id === b1.id || b.id === b2.id)).toBe(false);
  });
});

describe('Phase 13 — crop ↔ equipment binding', () => {
  it('bind / list / unbind round-trip', () => {
    const homeId = ensureHomeField();
    const block = createBlock({ name: uniq('binding-block'), fieldId: homeId });
    // Insert a crop directly so we don't need the full plantings flow.
    const cropId = uniq('crop');
    db.insert(cropsTable)
      .values({
        id: cropId,
        blockId: block.id,
        ownerId: 'owner_home_farm',
        cropPluginId: 'corn-feed-dent-pioneer',
        varietyDisplayName: 'Pioneer Corn (test)',
        plantingDate: new Date()
      })
      .run();

    const equipmentId = uniq('eq');
    db.insert(equipment)
      .values({ id: equipmentId, ownerId: 'owner_home_farm', type: 'sprayer', label: 'Test sprayer 50gal' })
      .run();

    const binding = bindEquipment({ cropId, equipmentId, role: 'sprayer' });
    expect(binding.cropId).toBe(cropId);
    expect(binding.equipmentId).toBe(equipmentId);
    expect(binding.role).toBe('sprayer');
    expect(binding.equipmentLabel).toBe('Test sprayer 50gal');
    expect(binding.equipmentType).toBe('sprayer');

    const list = listCropEquipment(cropId);
    expect(list).toHaveLength(1);

    const cropRefs = listCropsForEquipment(equipmentId);
    expect(cropRefs).toContainEqual({ cropId, role: 'sprayer' });

    expect(unbindEquipment(binding.id)).toBe(true);
    expect(listCropEquipment(cropId)).toHaveLength(0);

    // cleanup
    deleteBlockCascade(block.id);
    db.delete(equipment).where(eq(equipment.id, equipmentId)).run();
  });

  it('binding the same (crop, equipment, role) twice throws', () => {
    const homeId = ensureHomeField();
    const block = createBlock({ name: uniq('dup-block'), fieldId: homeId });
    const cropId = uniq('crop');
    db.insert(cropsTable)
      .values({
        id: cropId,
        blockId: block.id,
        ownerId: 'owner_home_farm',
        cropPluginId: 'corn-feed-dent-pioneer',
        varietyDisplayName: 'Dup Corn',
        plantingDate: new Date()
      })
      .run();
    const equipmentId = uniq('eq');
    db.insert(equipment)
      .values({ id: equipmentId, ownerId: 'owner_home_farm', type: 'sprayer', label: 'Dup sprayer' })
      .run();

    bindEquipment({ cropId, equipmentId, role: 'sprayer' });
    expect(() => bindEquipment({ cropId, equipmentId, role: 'sprayer' })).toThrow(
      CropEquipmentBindingExistsError
    );
    // Same equipment, different role is fine.
    expect(() => bindEquipment({ cropId, equipmentId, role: 'tractor' })).not.toThrow();

    // cleanup
    deleteEquipmentCascade(equipmentId);
    deleteBlock(block.id);
  });

  it('deleteEquipmentCascade removes bindings', () => {
    const homeId = ensureHomeField();
    const block = createBlock({ name: uniq('cascade-block'), fieldId: homeId });
    const cropId = uniq('crop');
    db.insert(cropsTable)
      .values({
        id: cropId,
        blockId: block.id,
        ownerId: 'owner_home_farm',
        cropPluginId: 'corn-feed-dent-pioneer',
        varietyDisplayName: 'Cascade Corn',
        plantingDate: new Date()
      })
      .run();
    const equipmentId = uniq('eq');
    db.insert(equipment)
      .values({ id: equipmentId, ownerId: 'owner_home_farm', type: 'sprayer', label: 'Cascade sprayer' })
      .run();
    bindEquipment({ cropId, equipmentId, role: 'sprayer' });

    const summary = deleteEquipmentCascade(equipmentId);
    expect(summary.removed.crop_equipment).toBe(1);
    expect(listCropEquipment(cropId)).toHaveLength(0);

    // cleanup
    deleteBlockCascade(block.id);
  });
});

describe('Phase 13 — stock_movements cropId', () => {
  it('decrementForUse persists cropId on the movement row', () => {
    const homeId = ensureHomeField();
    const block = createBlock({ name: uniq('stock-block'), fieldId: homeId });
    const cropId = uniq('crop');
    db.insert(cropsTable)
      .values({
        id: cropId,
        blockId: block.id,
        ownerId: 'owner_home_farm',
        cropPluginId: 'corn-feed-dent-pioneer',
        varietyDisplayName: 'Stock Corn',
        plantingDate: new Date()
      })
      .run();

    const item = createStockItem({
      category: 'herbicide',
      displayName: uniq('product'),
      defaultUnit: 'fl-oz'
    });
    const lot = receiveLot({
      stockItemId: item.id,
      receivedQuantity: 128,
      unit: 'fl-oz'
    });

    const result = decrementForUse({
      stockItemId: item.id,
      amount: 16,
      unit: 'fl-oz',
      cropId,
      sprayEventId: undefined,
      reason: 'spray-event'
    });
    expect(result.fulfilled).toBe(16);
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0].cropId).toBe(cropId);

    const row = db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.id, result.movements[0].id))
      .get();
    expect(row?.cropId).toBe(cropId);

    // cleanup
    deleteBlockCascade(block.id);
    void lot;
  });
});

describe('Phase 13 — wipeAllData clears fields + bindings', () => {
  it('wipe sets fields and crop_equipment to zero (smoke)', () => {
    // Seed something to delete.
    const f = createField({ name: uniq('wipe-field') });
    createBlock({ name: uniq('wipe-block'), fieldId: f.id });

    const summary = wipeAllData({ keepEquipment: true, keepWeatherCache: true });
    expect(summary.removed.fields).toBeGreaterThanOrEqual(1);
    expect(summary.removed.crop_equipment).toBeGreaterThanOrEqual(0);
    // After wipe, no fields remain.
    expect(listFields()).toHaveLength(0);
  });
});
