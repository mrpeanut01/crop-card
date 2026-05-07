/**
 * Functional smoke for Phase 11: every brand-name herbicide that uses the
 * trait override mechanism must register cleanly when its target crop
 * cultivar is also installed, AND the runtime kernel must permit the
 * (product, crop) pair while still blocking the same product over a
 * non-traited cultivar.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPluginsFromDirectory, PluginRegistry } from '$lib/plugins';
import { evaluateSpray, type SprayContext } from '$lib/safety';

const PLUGINS_DIR = path.resolve(__dirname, '../../../../plugins');

const TRAIT_GATED_BRANDS = [
  { herbicide: 'engenia', crop: 'soybean-asgrow-roundup-ready-2-xtend' },
  { herbicide: 'xtendimax', crop: 'soybean-asgrow-roundup-ready-2-xtend' },
  { herbicide: 'halex-gt', crop: 'corn-feed-dent-pioneer' },
  { herbicide: 'sandea', crop: 'tomato-roma-vf' },
  { herbicide: 'sandea', crop: 'tomato-cherokee-purple' },
  { herbicide: 'stinger', crop: 'strawberry-jewel' }
];

describe('Phase 11 — trait-gated brand plugins', () => {
  it('every brand plugin loads without bypass-rejection', async () => {
    const registry = new PluginRegistry();
    const result = await loadPluginsFromDirectory(registry, PLUGINS_DIR);
    const brandFailures = result.failed.filter((f) =>
      TRAIT_GATED_BRANDS.some((b) => f.file.includes(`${b.herbicide}.json`))
    );
    if (brandFailures.length > 0) {
      const summary = brandFailures
        .map((f) => `${path.basename(f.file)}: ${f.error.message}`)
        .join('\n');
      throw new Error(`expected zero brand failures, got:\n${summary}`);
    }
    expect(brandFailures).toHaveLength(0);
  });

  it('runtime kernel permits each (brand, traited cultivar) pair', async () => {
    const registry = new PluginRegistry();
    await loadPluginsFromDirectory(registry, PLUGINS_DIR);

    for (const { herbicide, crop } of TRAIT_GATED_BRANDS) {
      const h = registry.get(herbicide)?.plugin;
      const c = registry.get(crop)?.plugin;
      expect(h, `${herbicide} should be registered`).toBeDefined();
      expect(c, `${crop} should be registered`).toBeDefined();
      if (!h || !c || h.type !== 'herbicide' || c.type !== 'crop') continue;

      const ctx: SprayContext = {
        occurredAt: Date.now(),
        products: [
          {
            pluginId: h.pluginId,
            displayName: h.displayName,
            activeIngredients: h.activeIngredients,
            traitGatedSafeFor: h.traitGatedSafeFor
          }
        ],
        crop: {
          cropPluginId: c.pluginId,
          cropFamily: c.cropFamily,
          traits: c.traits ?? [],
          // Most brand plugins are POST so we use a safe stage default.
          heightInches: 4,
          growthStage: 'V4'
        },
        sprayer: { id: 'test-sprayer' },
        conditions: { windMph: 5, tempF: 72, rainForecastMmNext24h: 0 }
      };

      const result = evaluateSpray(ctx);
      // The trait override should have prevented the family-kill rule
      // from firing for this specific cultivar. Other gates (decon, env,
      // stage) may still fire — what we're verifying is that
      // CROP_INCOMPATIBLE doesn't appear for the trait-gated crop.
      const cropIncompat = !result.ok
        ? result.violations.filter(
            (v) => v.code === 'CROP_INCOMPATIBLE' && v.detail?.cropPluginId === c.pluginId
          )
        : [];
      expect(
        cropIncompat,
        `${herbicide} on ${crop} should not raise CROP_INCOMPATIBLE`
      ).toHaveLength(0);
    }
  });

  it('runtime kernel still blocks brand plugin on a non-traited cultivar of the same family', async () => {
    const registry = new PluginRegistry();
    await loadPluginsFromDirectory(registry, PLUGINS_DIR);

    // Engenia on a non-Xtend soybean (e.g., bush-bean-provider is legume family).
    const engenia = registry.get('engenia')?.plugin;
    const beans = registry.get('bush-bean-provider')?.plugin;
    if (engenia?.type !== 'herbicide' || beans?.type !== 'crop') return;

    const ctx: SprayContext = {
      occurredAt: Date.now(),
      products: [
        {
          pluginId: engenia.pluginId,
          displayName: engenia.displayName,
          activeIngredients: engenia.activeIngredients,
          traitGatedSafeFor: engenia.traitGatedSafeFor
        }
      ],
      crop: {
        cropPluginId: beans.pluginId,
        cropFamily: beans.cropFamily,
        traits: beans.traits ?? []
      },
      sprayer: { id: 'test-sprayer' },
      conditions: { windMph: 5, tempF: 72, rainForecastMmNext24h: 0 }
    };

    const result = evaluateSpray(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.violations.some(
          (v) => v.code === 'CROP_INCOMPATIBLE' && v.detail?.cropFamily === 'legume'
        )
      ).toBe(true);
    }
  });
});
