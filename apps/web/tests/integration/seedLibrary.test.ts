import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory, PluginRegistry } from '$lib/plugins';
import { evaluateSpray, type SprayContext } from '$lib/safety';

const PLUGINS_DIR = path.resolve(__dirname, '../../../../plugins');

describe('seed plugin library', () => {
  it('loads every committed plugin without validation errors', async () => {
    const registry = new PluginRegistry();
    const result = await loadPluginsFromDirectory(registry, PLUGINS_DIR);
    if (result.failed.length > 0) {
      const summary = result.failed
        .map((f) => `${path.basename(f.file)}: ${f.error.message}`)
        .join('\n');
      throw new Error(`expected zero failures, got:\n${summary}`);
    }
    expect(result.failed).toHaveLength(0);
    expect(result.registered.length).toBeGreaterThanOrEqual(8);
  });

  it('covers all crop families and chemistry classes', async () => {
    const registry = new PluginRegistry();
    await loadPluginsFromDirectory(registry, PLUGINS_DIR);

    const families = new Set(registry.crops().map((c) => c.cropFamily));
    expect(families.has('corn')).toBe(true);
    expect(families.has('cucurbit')).toBe(true);
    expect(families.has('legume')).toBe(true);
    expect(families.has('broadleaf-companion')).toBe(true);
    expect(families.has('orchard')).toBe(true);
    expect(families.has('cover-grass')).toBe(true);
    expect(families.has('cover-legume')).toBe(true);

    const classes = new Set(
      registry.herbicides().flatMap((h) => h.activeIngredients.map((ai) => ai.chemistryClass))
    );
    expect(classes.has('synthetic-auxin')).toBe(true);
    expect(classes.has('chloroacetamide')).toBe(true);
    expect(classes.has('hppd-inhibitor')).toBe(true);
    expect(classes.has('accase-inhibitor')).toBe(true);
    expect(classes.has('glyphosate')).toBe(true);
    expect(classes.has('sulfonylurea')).toBe(true);
  });

  it('blocks 2,4-D when block has corn + pole beans (Three Sisters scenario)', async () => {
    const registry = new PluginRegistry();
    await loadPluginsFromDirectory(registry, PLUGINS_DIR);

    const auxin = registry.get('2-4-d-amine')!.plugin;
    expect(auxin.type).toBe('herbicide');

    const ctx: SprayContext = {
      occurredAt: Date.now(),
      products: [
        {
          pluginId: '2-4-d-amine',
          displayName: auxin.displayName,
          activeIngredients: auxin.type === 'herbicide' ? auxin.activeIngredients : []
        }
      ],
      crop: { cropPluginId: 'corn-bloody-butcher', cropFamily: 'corn', heightInches: 6 },
      coPlantedCrops: [{ cropPluginId: 'pole-beans-rattlesnake', cropFamily: 'legume' }],
      sprayer: { id: 'CORN' },
      conditions: { windMph: 5, tempF: 70, rainForecastMmNext24h: 0 }
    };

    const result = evaluateSpray(ctx);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.code === 'CROP_INCOMPATIBLE')).toBe(true);
  });

  it('passes Mesotrione over corn-only block at V4–V6', async () => {
    const registry = new PluginRegistry();
    await loadPluginsFromDirectory(registry, PLUGINS_DIR);

    const meso = registry.get('mesotrione-4sc')!.plugin;
    expect(meso.type).toBe('herbicide');

    const ctx: SprayContext = {
      occurredAt: Date.now(),
      products: [
        {
          pluginId: 'mesotrione-4sc',
          displayName: meso.displayName,
          activeIngredients: meso.type === 'herbicide' ? meso.activeIngredients : []
        }
      ],
      crop: { cropPluginId: 'corn-bloody-butcher', cropFamily: 'corn', heightInches: 18 },
      sprayer: { id: 'CORN' },
      conditions: { windMph: 5, tempF: 70, rainForecastMmNext24h: 0 }
    };

    const result = evaluateSpray(ctx);
    expect(result.ok).toBe(true);
  });
});
