import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import { validateManualChoices, type ManualChoice } from './inputsChoiceValidate';

const herbicide = (pluginId: string, chemistryClass: string, flags = {}) => ({
  type: 'herbicide',
  pluginId,
  displayName: pluginId,
  activeIngredients: [{ name: pluginId, chemistryClass }],
  ratePerAcre: { amount: 2, unit: 'pt' },
  complianceFlags: flags
});

const products = new Map<string, { type: string; pluginId: string; displayName: string }>([
  ['glufo', herbicide('glufo', 'ppo-inhibitor', { nonGmoCompliant: true })],
  ['two-four-d', herbicide('two-four-d', 'synthetic-auxin')],
  ['omri-soap', herbicide('omri-soap', 'ppo-inhibitor', { omriListed: true })]
]);
const cropPlugins = {
  beans: { pluginId: 'beans', displayName: 'Beans', cropFamily: 'legume' } as CropPlugin
};

const choice = (over: Partial<ManualChoice>): ManualChoice => ({
  id: 'a',
  slot: 'post-emergent',
  cropPluginId: 'beans',
  productPluginId: 'glufo',
  productCategory: 'herbicide',
  rateAmount: 2,
  productSource: 'manual',
  ...over
});

describe('manual input choices (#480)', () => {
  it('passes an allowed, crop-safe product at label rate', () => {
    expect(
      validateManualChoices([choice({})], { products, cropPlugins, philosophy: 'conventional' })
    ).toEqual([]);
  });

  it('checks the philosophy first', () => {
    const problems = validateManualChoices([choice({})], {
      products,
      cropPlugins,
      philosophy: 'certified-organic'
    });
    expect(problems[0]).toMatch(/not allowed under your certified-organic season/);
  });

  it('refuses a post-emergent herbicide that harms the crop', () => {
    const problems = validateManualChoices([choice({ productPluginId: 'two-four-d' })], {
      products,
      cropPlugins,
      philosophy: 'conventional'
    });
    expect(problems[0]).toMatch(/would harm Beans/);
  });

  it('lets the same herbicide go on before the crop is up', () => {
    expect(
      validateManualChoices([choice({ productPluginId: 'two-four-d', slot: 'burndown' })], {
        products,
        cropPlugins,
        philosophy: 'conventional'
      })
    ).toEqual([]);
  });

  it('refuses a rate over the label ceiling', () => {
    const problems = validateManualChoices([choice({ rateAmount: 5 })], {
      products,
      cropPlugins,
      philosophy: 'conventional'
    });
    expect(problems[0]).toMatch(/above its label rate/);
  });

  it('checks every committed product whatever the client says its source is', () => {
    for (const productSource of ['plugin', 'data', 'ai', undefined]) {
      const problems = validateManualChoices(
        [choice({ productPluginId: 'two-four-d', productSource })],
        { products, cropPlugins, philosophy: 'conventional' }
      );
      expect(problems[0]).toMatch(/would harm Beans/);
    }
    expect(
      validateManualChoices([choice({ productPluginId: 'nope', productSource: 'plugin' })], {
        products,
        cropPlugins,
        philosophy: 'conventional'
      })[0]
    ).toMatch(/not a known herbicide/);
  });

  it('skips rows with no product', () => {
    expect(
      validateManualChoices([choice({ productPluginId: null, productSource: 'plugin' })], {
        products,
        cropPlugins,
        philosophy: 'conventional'
      })
    ).toEqual([]);
  });
});
