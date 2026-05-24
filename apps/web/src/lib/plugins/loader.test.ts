import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory } from './loader';
import { PluginRegistry } from './registry';

describe('loadPluginsFromDirectory', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cropcard-plugins-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('loads valid plugins from nested subdirectories', async () => {
    await mkdir(path.join(tmp, 'crops'));
    await writeFile(
      path.join(tmp, 'crops', 'corn.json'),
      JSON.stringify({
        pluginId: 'corn',
        type: 'crop',
        displayName: 'Corn',
        version: '1.0.0',
        cropFamily: 'corn',
        harvestStyle: 'row-grain-pollinated',
        bloomWindow: { daysFromPlantingMin: 55, daysFromPlantingMax: 75, beeAttractive: false }
      })
    );
    await mkdir(path.join(tmp, 'herbicides'));
    await writeFile(
      path.join(tmp, 'herbicides', 'gly.json'),
      JSON.stringify({
        pluginId: 'gly',
        type: 'herbicide',
        displayName: 'Glyphosate',
        version: '1.0.0',
        activeIngredients: [{ name: 'glyphosate', chemistryClass: 'glyphosate' }],
        ratePerAcre: { amount: 32, unit: 'fl-oz' }
      })
    );

    const registry = new PluginRegistry();
    const result = await loadPluginsFromDirectory(registry, tmp);
    expect(result.registered).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    expect(registry.has('corn')).toBe(true);
    expect(registry.has('gly')).toBe(true);
  });

  it('continues past invalid files and reports them', async () => {
    await writeFile(path.join(tmp, 'broken.json'), '{ not valid json');
    await writeFile(
      path.join(tmp, 'good.json'),
      JSON.stringify({
        pluginId: 'good',
        type: 'crop',
        displayName: 'Good',
        version: '1.0.0',
        cropFamily: 'corn',
        harvestStyle: 'row-grain-pollinated',
        bloomWindow: { daysFromPlantingMin: 55, daysFromPlantingMax: 75, beeAttractive: false }
      })
    );

    const registry = new PluginRegistry();
    const result = await loadPluginsFromDirectory(registry, tmp);
    expect(result.registered).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].file).toMatch(/broken\.json$/);
  });

  it('rejects bypass-attempt plugins via the registry', async () => {
    await writeFile(
      path.join(tmp, 'sneaky.json'),
      JSON.stringify({
        pluginId: 'sneaky',
        type: 'herbicide',
        displayName: 'Sneaky 2,4-D',
        version: '1.0.0',
        activeIngredients: [{ name: '2,4-D', chemistryClass: 'synthetic-auxin' }],
        ratePerAcre: { amount: 16, unit: 'fl-oz' },
        labelClaims: { safeForCropPluginIds: ['pumpkin'] }
      })
    );

    const registry = new PluginRegistry();
    const result = await loadPluginsFromDirectory(registry, tmp);
    expect(result.registered).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(registry.has('sneaky')).toBe(false);
  });

  it('returns empty result for missing directory', async () => {
    const registry = new PluginRegistry();
    const result = await loadPluginsFromDirectory(registry, path.join(tmp, 'does-not-exist'));
    expect(result.registered).toEqual([]);
    expect(result.failed).toEqual([]);
  });
});
