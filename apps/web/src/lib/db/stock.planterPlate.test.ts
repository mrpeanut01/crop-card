/**
 * UC-41 — the planter-plate selector writes `planterPlateConfig` into
 * `stockItems.metadataJson`. This test asserts the merge preserves any
 * other top-level keys already in the JSON and that the value round-trips
 * cleanly through `updateStockItem` → `getStockItem`.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createStockItem, getStockItem, updateStockItem } from './stock';
import { runWithTenant } from './tenant';

const TEST_OWNER_ID = 'owner_home_farm';

function uniq(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe('stock.metadataJson — planterPlateConfig round-trip', () => {
  it('persists planterPlateConfig and survives reload', () =>
    runWithTenant(TEST_OWNER_ID, () => {
      const item = createStockItem({
        category: 'seed',
        displayName: uniq('Sweet corn seed'),
        defaultUnit: 'lb'
      });

      const config = {
        plateNumber: 'B13-16',
        series: 'B',
        brand: 'John Deere',
        cells: 16,
        color: 'Lt. Blue',
        dimensions: '38-15-20',
        L: 38,
        D: 15,
        T: 20,
        shape: 'Flat',
        seedType: 'Corn',
        gradeSize: 'F8',
        seedDimensions: { L: 38, D: 15, T: 20, tolerance: 0 },
        savedAt: '2026-05-11T12:00:00.000Z'
      };

      updateStockItem(item.id, {
        metadataJson: JSON.stringify({ planterPlateConfig: config })
      });

      const reloaded = getStockItem(item.id);
      expect(reloaded?.metadataJson).toBeTruthy();
      const parsed = JSON.parse(reloaded!.metadataJson!);
      expect(parsed.planterPlateConfig).toEqual(config);
    }));

  it('merging planterPlateConfig does not clobber other metadata keys', () =>
    runWithTenant(TEST_OWNER_ID, () => {
      const item = createStockItem({
        category: 'seed',
        displayName: uniq('Soybean seed'),
        defaultUnit: 'lb',
        metadataJson: JSON.stringify({
          legacyFlag: true,
          someOtherKey: { nested: 'value' }
        })
      });

      const before = getStockItem(item.id);
      const existing = JSON.parse(before!.metadataJson!);
      const merged = {
        ...existing,
        planterPlateConfig: { plateNumber: 'B-Soy 2', cells: 24 }
      };
      updateStockItem(item.id, { metadataJson: JSON.stringify(merged) });

      const after = getStockItem(item.id);
      const parsed = JSON.parse(after!.metadataJson!);
      expect(parsed.legacyFlag).toBe(true);
      expect(parsed.someOtherKey).toEqual({ nested: 'value' });
      expect(parsed.planterPlateConfig.plateNumber).toBe('B-Soy 2');
      expect(parsed.planterPlateConfig.cells).toBe(24);
    }));

  it('overwrites an earlier planterPlateConfig on re-save', () =>
    runWithTenant(TEST_OWNER_ID, () => {
      const item = createStockItem({
        category: 'seed',
        displayName: uniq('Sorghum seed'),
        defaultUnit: 'lb'
      });

      updateStockItem(item.id, {
        metadataJson: JSON.stringify({
          planterPlateConfig: { plateNumber: 'B-Sorg 13-30' }
        })
      });
      const intermediate = JSON.parse(getStockItem(item.id)!.metadataJson!);

      updateStockItem(item.id, {
        metadataJson: JSON.stringify({
          ...intermediate,
          planterPlateConfig: { plateNumber: 'B-Sorg 12-60' }
        })
      });

      const after = JSON.parse(getStockItem(item.id)!.metadataJson!);
      expect(after.planterPlateConfig.plateNumber).toBe('B-Sorg 12-60');
    }));
});
