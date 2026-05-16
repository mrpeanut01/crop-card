/**
 * Regression test for the "drag-drop a seed onto a block where it already
 * exists creates a duplicate row" bug. `addPlanting` merges into an existing
 * planned-status / null-date row when the block + cropPluginId + unit match,
 * summing quantities instead of inserting a duplicate.
 *
 * Phase 18a: wraps each test in `runWithTenant(TEST_OWNER_ID)` so the
 * tenant-scoped repos can resolve `requireOwnerId()`. Uses the migration's
 * deterministic Home Farm id so we don't have to seed a separate owner.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { addPlanting, createBlock } from './blocks';
import { db } from './client';
import { plantingRecords } from './schema';
import { runWithTenant } from './tenant';

const TEST_OWNER_ID = 'owner_home_farm';

function uniq(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function countPlantedRowsFor(blockId: string, cropPluginId: string): number {
  return db
    .select()
    .from(plantingRecords)
    .where(
      and(
        eq(plantingRecords.blockId, blockId),
        eq(plantingRecords.cropPluginId, cropPluginId),
        eq(plantingRecords.status, 'planned'),
        isNull(plantingRecords.plantingDate)
      )
    )
    .all().length;
}

function quantityFor(plantingId: string): number | null {
  const row = db
    .select()
    .from(plantingRecords)
    .where(eq(plantingRecords.id, plantingId))
    .get();
  return row?.quantityPlantedHundredths ?? null;
}

describe('addPlanting — merge into existing planned bucket', () => {
  it('second drop on same block + same plugin + same unit increments the existing row', () =>
    runWithTenant(TEST_OWNER_ID, () => {
      const block = createBlock({ name: uniq('addplanting-merge') });
      const plugin = uniq('plugin:tomato');

      const first = addPlanting({
        blockId: block.id,
        cropPluginId: plugin,
        varietyDisplayName: 'Howden',
        plantingDate: null,
        quantityPlanted: 25,
        quantityUnit: 'seeds'
      });

      const second = addPlanting({
        blockId: block.id,
        cropPluginId: plugin,
        varietyDisplayName: 'Howden',
        plantingDate: null,
        quantityPlanted: 10,
        quantityUnit: 'seeds'
      });

      expect(second.id).toBe(first.id);
      expect(countPlantedRowsFor(block.id, plugin)).toBe(1);
      expect(quantityFor(first.id)).toBe((25 + 10) * 100);
    }));

  it('different units do NOT merge — distinct rows stay distinct', () =>
    runWithTenant(TEST_OWNER_ID, () => {
      const block = createBlock({ name: uniq('addplanting-distinct-unit') });
      const plugin = uniq('plugin:corn');

      const a = addPlanting({
        blockId: block.id,
        cropPluginId: plugin,
        varietyDisplayName: 'Reds',
        plantingDate: null,
        quantityPlanted: 5,
        quantityUnit: 'lb'
      });
      const b = addPlanting({
        blockId: block.id,
        cropPluginId: plugin,
        varietyDisplayName: 'Reds',
        plantingDate: null,
        quantityPlanted: 100,
        quantityUnit: 'seeds'
      });

      expect(b.id).not.toBe(a.id);
      expect(countPlantedRowsFor(block.id, plugin)).toBe(2);
    }));

  it('a row with a planting date does NOT swallow a new planned drop', () =>
    runWithTenant(TEST_OWNER_ID, () => {
      const block = createBlock({ name: uniq('addplanting-date-isolation') });
      const plugin = uniq('plugin:lettuce');

      const dated = addPlanting({
        blockId: block.id,
        cropPluginId: plugin,
        varietyDisplayName: 'Buttercrunch',
        plantingDate: Date.now(),
        quantityPlanted: 50,
        quantityUnit: 'seeds'
      });

      const planned = addPlanting({
        blockId: block.id,
        cropPluginId: plugin,
        varietyDisplayName: 'Buttercrunch',
        plantingDate: null,
        quantityPlanted: 30,
        quantityUnit: 'seeds'
      });

      expect(planned.id).not.toBe(dated.id);
      expect(countPlantedRowsFor(block.id, plugin)).toBe(1);
      expect(quantityFor(planned.id)).toBe(30 * 100);
    }));
});
