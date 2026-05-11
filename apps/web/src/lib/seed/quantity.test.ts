import { describe, expect, it } from 'vitest';
import { plantsToLbs, seedsPerLb, seedsToPlants } from './quantity';
import type { CropPlugin } from '$lib/plugins/schemas';

function plugin(over: Partial<CropPlugin> & { pluginId: string }): CropPlugin {
  return {
    pluginId: over.pluginId,
    type: 'crop',
    displayName: over.displayName ?? over.pluginId,
    version: '1.0.0',
    cropFamily: over.cropFamily ?? 'corn',
    plantingGuide: over.plantingGuide,
    daysToMaturity: { min: 60, max: 90 }
  } as CropPlugin;
}

describe('seedsPerLb', () => {
  it('derives seeds-per-lb from seedsPerAcre / recommendedLbsPerAcre', () => {
    const corn = plugin({
      pluginId: 'corn',
      cropFamily: 'corn',
      plantingGuide: { seedsPerAcre: 28000, recommendedLbsPerAcre: 16 }
    });
    expect(seedsPerLb(corn)).toBe(1750);
  });

  it('falls back to family default when only seedsPerAcre is present', () => {
    const corn = plugin({
      pluginId: 'corn',
      cropFamily: 'corn',
      plantingGuide: { seedsPerAcre: 28000 }
    });
    expect(seedsPerLb(corn)).toBe(1500);
  });

  it('uses family default with no plantingGuide.seedsPerAcre', () => {
    const lettuce = plugin({ pluginId: 'lettuce', cropFamily: 'leafy-green' });
    expect(seedsPerLb(lettuce)).toBe(350000);
  });

  it('returns null when no plugin is supplied', () => {
    expect(seedsPerLb(undefined)).toBeNull();
  });
});

describe('seedsToPlants — unit conversions', () => {
  const corn = plugin({
    pluginId: 'corn',
    cropFamily: 'corn',
    plantingGuide: { seedsPerAcre: 28000, recommendedLbsPerAcre: 14 }
  });

  it('converts lb → plants using derived seedsPerLb and germination', () => {
    // 28000 / 14 = 2000 seeds/lb. 0.5 lb = 1000 seeds. germ 0.85 → 850 plants.
    const r = seedsToPlants({ unit: 'lb', quantity: 0.5, plugin: corn });
    expect(r?.rawSeeds).toBe(1000);
    expect(r?.plants).toBe(850);
    expect(r?.fellBackToFamilyDefault).toBe(false);
  });

  it('converts oz to plants', () => {
    const r = seedsToPlants({ unit: 'oz', quantity: 16, plugin: corn });
    expect(r?.plants).toBe(1700); // = 1 lb × 2000 × 0.85
  });

  it('converts grams to plants', () => {
    // 453.592 g = 1 lb. 226.796 g = 0.5 lb = 1000 seeds × 0.85 = 850.
    const r = seedsToPlants({ unit: 'g', quantity: 226.796, plugin: corn });
    expect(r?.plants).toBeGreaterThanOrEqual(849);
    expect(r?.plants).toBeLessThanOrEqual(851);
  });

  it('treats `seeds` unit as raw count, applies germination', () => {
    const r = seedsToPlants({ unit: 'seeds', quantity: 1000, plugin: corn });
    expect(r?.rawSeeds).toBe(1000);
    expect(r?.plants).toBe(850);
  });

  it('treats `count` unit as 1:1 plants (no germination discount)', () => {
    const r = seedsToPlants({ unit: 'count', quantity: 25, plugin: corn });
    expect(r?.rawSeeds).toBe(25);
    expect(r?.plants).toBe(25);
  });

  it('`count` ignores germination override (already discrete plants)', () => {
    const r = seedsToPlants({ unit: 'count', quantity: 25, plugin: corn, germinationPct: 0.5 });
    expect(r?.plants).toBe(25);
  });

  it('`count` works without a plugin (no spacing math needed)', () => {
    const r = seedsToPlants({ unit: 'count', quantity: 25, plugin: undefined });
    expect(r?.plants).toBe(25);
  });

  it('treats packets as 50 seeds by default', () => {
    const r = seedsToPlants({ unit: 'packets', quantity: 12, plugin: corn });
    expect(r?.rawSeeds).toBe(600);
    expect(r?.plants).toBe(510);
  });

  it('honors a custom germination percentage', () => {
    const r = seedsToPlants({ unit: 'lb', quantity: 0.5, plugin: corn, germinationPct: 0.5 });
    expect(r?.plants).toBe(500);
  });

  it('returns null when no plugin AND no override is available for a weight unit', () => {
    expect(seedsToPlants({ unit: 'lb', quantity: 1, plugin: undefined })).toBeNull();
  });

  it('honors a seedsPerLb override (lot-specific)', () => {
    const r = seedsToPlants({
      unit: 'lb',
      quantity: 1,
      plugin: corn,
      seedsPerLbOverride: 1000,
      germinationPct: 1
    });
    expect(r?.rawSeeds).toBe(1000);
    expect(r?.plants).toBe(1000);
    expect(r?.fellBackToFamilyDefault).toBe(false);
  });

  it('rejects negative quantity', () => {
    expect(seedsToPlants({ unit: 'lb', quantity: -1, plugin: corn })).toBeNull();
  });
});

describe('plantsToLbs round-trip', () => {
  it('inverts seedsToPlants for the same plugin', () => {
    const pumpkin = plugin({
      pluginId: 'pumpkin',
      cropFamily: 'cucurbit',
      plantingGuide: { seedsPerAcre: 1500, recommendedLbsPerAcre: 0.5 }
    });
    const lbsIn = 0.5;
    const r = seedsToPlants({ unit: 'lb', quantity: lbsIn, plugin: pumpkin });
    expect(r).not.toBeNull();
    const lbsOut = plantsToLbs(r!.plants, pumpkin);
    expect(lbsOut).toBeCloseTo(lbsIn, 3);
  });
});

describe('seedsToPlants — fallback flag', () => {
  it('marks fellBackToFamilyDefault when only seedsPerAcre is present', () => {
    const seeded = plugin({
      pluginId: 'x',
      cropFamily: 'corn',
      plantingGuide: { seedsPerAcre: 28000 }
    });
    const r = seedsToPlants({ unit: 'lb', quantity: 1, plugin: seeded });
    expect(r?.fellBackToFamilyDefault).toBe(true);
  });
  it('does not flag fallback when both seedsPerAcre and recommendedLbsPerAcre are present', () => {
    const seeded = plugin({
      pluginId: 'x',
      cropFamily: 'corn',
      plantingGuide: { seedsPerAcre: 28000, recommendedLbsPerAcre: 14 }
    });
    const r = seedsToPlants({ unit: 'lb', quantity: 1, plugin: seeded });
    expect(r?.fellBackToFamilyDefault).toBe(false);
  });
});
