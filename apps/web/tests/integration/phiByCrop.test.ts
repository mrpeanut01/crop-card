import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory, PluginRegistry } from '$lib/plugins';
import { phiCropOf, phiCropsFor } from '$lib/server/phiCrops';
import {
  longestPhiDays,
  phiDaysForCrop,
  phiDaysForCrops,
  type PhiProduct
} from '$lib/safety/preHarvestInterval';

const PLUGINS_DIR = path.resolve(__dirname, '../../../../plugins');

// #661: the record endpoints and the harvest check read the label PHI for
// the crop through phiCropsFor / phiCropOf; check that against the shipped
// library, not a fixture.
describe('label PHI by crop in the shipped library (#661)', () => {
  const registry = new PluginRegistry();
  beforeAll(async () => {
    await loadPluginsFromDirectory(registry, PLUGINS_DIR);
  });

  function product(id: string): PhiProduct {
    const rec = registry.get(id);
    if (!rec) throw new Error(`missing plugin ${id}`);
    return rec.plugin as PhiProduct;
  }

  it('Warrior II: field corn 21 days, sweet corn 1 day, a block with both 21', () => {
    const warrior = product('warrior-ii-with-zeon');
    expect(phiDaysForCrop(warrior, phiCropOf(registry, 'corn-feed-dent-pioneer'))).toEqual({
      days: 21,
      basis: 'family'
    });
    expect(phiDaysForCrop(warrior, phiCropOf(registry, 'sweet-corn-silver-queen-f1'))).toEqual({
      days: 1,
      basis: 'crop'
    });
    expect(
      phiDaysForCrops(
        warrior,
        phiCropsFor(registry, ['sweet-corn-silver-queen-f1', 'corn-feed-dent-pioneer'])
      )
    ).toBe(21);
    expect(phiDaysForCrops(warrior, phiCropsFor(registry, ['wheat-soft-red-winter']))).toBe(30);
    expect(
      phiDaysForCrops(warrior, phiCropsFor(registry, ['soybean-asgrow-roundup-ready-2-xtend']))
    ).toBe(30);
  });

  it('a crop the label does not list gets the longest PHI on file', () => {
    const warrior = product('warrior-ii-with-zeon');
    const carrot = phiDaysForCrop(warrior, phiCropOf(registry, 'carrot-danvers-126'));
    expect(carrot).toEqual({ days: longestPhiDays(warrior), basis: 'longest' });
    expect(carrot.days).toBeGreaterThanOrEqual(21);
  });

  it('every by-crop row names a crop in the library and never exceeds the longest', () => {
    for (const rec of registry.all()) {
      const p = rec.plugin as PhiProduct & { pluginId: string };
      const rows = p.preHarvestIntervalsByCrop ?? [];
      for (const row of rows) {
        if (row.cropPluginId) {
          expect(
            registry.get(row.cropPluginId)?.plugin.type,
            `${p.pluginId} ${row.cropPluginId}`
          ).toBe('crop');
          expect(phiDaysForCrop(p, phiCropOf(registry, row.cropPluginId)).days).toBe(
            row.preHarvestIntervalDays
          );
        }
        expect(row.preHarvestIntervalDays).toBeLessThanOrEqual(longestPhiDays(p) ?? 0);
      }
    }
  });
});
