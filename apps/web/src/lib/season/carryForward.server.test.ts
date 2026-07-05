/**
 * UC-47 — Full-data carry-forward server orchestration (Phase 28).
 *
 * Exercises `runCarryForward` against a real (in-memory CI) DB with an
 * injected plugin index, so the registry singleton isn't required. Seeds a
 * minimal farm: one block with a prior-season solanaceae planting + a
 * terminated cover crop, an expired stock lot, and an uncalibrated sprayer.
 * Verifies the five deliverables wire through + that `apply` writes the
 * expiry movement.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { createBlock } from '$lib/db/blocks';
import { db } from '$lib/db/client';
import { addPlanting } from '$lib/db/blocks';
import { updateStatus } from '$lib/db/crops';
import { createEquipment } from '$lib/db/equipment';
import { appSettings, owners } from '$lib/db/schema';
import { createStockItem, listMovementsForItem, receiveLot } from '$lib/db/stock';
import { runWithTenant } from '$lib/db/tenant';
import type { CropPlugin } from '$lib/plugins/schemas';

import { runCarryForward } from './carryForward.server';

const OWNER = 'uc47-carry-forward-owner';

function seedOwner(ownerId: string): void {
  db.insert(owners)
    .values({ id: ownerId, name: ownerId, slug: ownerId, billingStatus: 'active' })
    .onConflictDoNothing()
    .run();
}

function makePlugin(
  over: Partial<CropPlugin> & { pluginId: string; cropFamily: string }
): CropPlugin {
  return {
    type: 'crop',
    schemaVersion: '1.0',
    displayName: over.pluginId,
    harvestStyle: 'single-event',
    bloomWindow: { beeAttractive: false },
    ...over
  } as unknown as CropPlugin;
}

const pluginIndex: Record<string, CropPlugin> = {
  'tomato-cherokee': makePlugin({
    pluginId: 'tomato-cherokee',
    cropFamily: 'solanaceae',
    agronomy: { rotationLookbackYears: 3 }
  }),
  'crimson-clover-cover': makePlugin({
    pluginId: 'crimson-clover-cover',
    cropFamily: 'cover-crop-legume',
    archetype: 'cover-crop.termination'
  } as never)
};

const NOW = Date.UTC(2025, 10, 15); // Nov 15 2025

describe('runCarryForward (UC-47 orchestration)', () => {
  beforeEach(() => {
    db.delete(appSettings).run();
  });

  it('produces rotation warnings, N-credit re-key, and clones — and applies expiry movements', () => {
    runWithTenant(OWNER, () => {
      seedOwner(OWNER);

      const block = createBlock({ name: 'North', acres: 1 });

      // Prior-season tomato (harvested) — solanaceae, 3-year plant-back.
      const tomato = addPlanting({
        blockId: block.id,
        cropPluginId: 'tomato-cherokee',
        varietyDisplayName: 'Cherokee Purple',
        plantingDate: Date.UTC(2025, 4, 20)
      });
      updateStatus(tomato.id, 'harvested', Date.UTC(2025, 8, 1));

      // Terminated cover crop on the same block.
      const cover = addPlanting({
        blockId: block.id,
        cropPluginId: 'crimson-clover-cover',
        varietyDisplayName: 'Crimson Clover',
        plantingDate: Date.UTC(2025, 2, 1)
      });
      updateStatus(cover.id, 'harvested', Date.UTC(2025, 4, 1));

      // Expired stock lot.
      const item = createStockItem({
        category: 'herbicide',
        displayName: 'Roundup PowerMAX',
        defaultUnit: 'gal'
      });
      receiveLot({
        stockItemId: item.id,
        receivedQuantity: 2,
        unit: 'gal',
        expiresAt: Date.UTC(2025, 5, 1) // expired before NOW
      });

      // Uncalibrated sprayer.
      createEquipment({ type: 'sprayer', label: 'Boom 300' });

      // Dry-run preview.
      const preview = runCarryForward(
        { fromYear: 2025, toYear: 2026, apply: false, nowMs: NOW },
        pluginIndex
      );

      const northRot = preview.rotation.find((r) => r.blockId === block.id);
      expect(northRot?.severity).toBe('warn');
      expect(northRot?.avoidFamilies).toContain('solanaceae');

      const nCredit = preview.nCredits.find((n) => n.blockId === block.id);
      expect(nCredit?.nCreditLbPerAcre).toBe(70); // crimson clover default
      expect(nCredit?.sourcePluginIds).toEqual(['crimson-clover-cover']);

      expect(preview.clonedPlantings.length).toBeGreaterThanOrEqual(1);
      expect(preview.clonedPlantings.every((c) => c.sourceProvenance === 'fallback')).toBe(true);

      expect(preview.calibration.some((c) => c.needsRecalibration)).toBe(true);

      expect(preview.stock.some((s) => s.disposition === 'expired')).toBe(true);
      expect(preview.applied).toBeNull();

      // Apply run writes the expiry movement.
      const applied = runCarryForward(
        { fromYear: 2025, toYear: 2026, apply: true, nowMs: NOW },
        pluginIndex
      );
      expect(applied.applied?.expiryMovementsWritten).toBe(1);
      expect(applied.applied?.wizardDraftPlanId).toBe('carry-forward-2026');

      const movements = listMovementsForItem(item.id);
      expect(movements.some((m) => m.reason === 'expiry' && m.delta < 0)).toBe(true);
    });
  });

  it('is a no-op-safe empty result when the farm has nothing prior', () => {
    runWithTenant(`${OWNER}-empty`, () => {
      seedOwner(`${OWNER}-empty`);
      const r = runCarryForward(
        { fromYear: 2025, toYear: 2026, apply: false, nowMs: NOW },
        pluginIndex
      );
      expect(r.summary.plantingsCloned).toBe(0);
      expect(r.summary.blocksWithNCredit).toBe(0);
      expect(r.applied).toBeNull();
    });
  });
});
