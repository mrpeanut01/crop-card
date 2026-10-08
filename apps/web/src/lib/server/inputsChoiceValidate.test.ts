import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import { validateManualChoices, type ManualChoice } from './inputsChoiceValidate';

const herbicide = (pluginId: string, chemistryClass: string, flags = {}) => ({
  type: 'herbicide',
  pluginId,
  displayName: pluginId,
  activeIngredients: [{ name: pluginId, chemistryClass }],
  ratePerAcre: { amount: 2, unit: 'pt' },
  rateProvenance: 'label',
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

  it('converts the rate to the label unit before comparing (2 qt is over a 2 pt ceiling)', () => {
    const ctx = { products, cropPlugins, philosophy: 'conventional' as const };
    expect(validateManualChoices([choice({ rateAmount: 2, rateUnit: 'qt' })], ctx)[0]).toMatch(
      /above its label rate \(2 pt per acre\)/
    );
    expect(validateManualChoices([choice({ rateAmount: 32, rateUnit: 'fl-oz' })], ctx)).toEqual([]);
  });

  it('refuses a rate in a unit that cannot be converted, and a rate not above zero', () => {
    const ctx = { products, cropPlugins, philosophy: 'conventional' as const };
    expect(validateManualChoices([choice({ rateAmount: 1, rateUnit: 'lb' })], ctx)[0]).toMatch(
      /must be in pt per acre/
    );
    expect(validateManualChoices([choice({ rateAmount: -4 })], ctx)[0]).toMatch(/above zero/);
    expect(validateManualChoices([choice({ rateAmount: 0 })], ctx)[0]).toMatch(/above zero/);
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

  it('never treats a typical (fallback) herbicide rate as a ceiling (#737 swarm 2026-10-07)', () => {
    const typical = new Map(products);
    const typ = {
      ...herbicide('typ', 'ppo-inhibitor', { nonGmoCompliant: true }),
      rateProvenance: 'fallback'
    };
    typical.set('typ', typ);
    const ctx = { products: typical, cropPlugins, philosophy: 'conventional' as const };
    expect(validateManualChoices([choice({ productPluginId: 'typ', rateAmount: 2 })], ctx)).toEqual(
      []
    );
    expect(
      validateManualChoices(
        [choice({ productPluginId: 'typ', rateAmount: 1, rateUnit: 'qt' })],
        ctx
      )
    ).toEqual([]);
    for (const rateAmount of [1, 1.9, 2.1]) {
      const problems = validateManualChoices([choice({ productPluginId: 'typ', rateAmount })], ctx);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/no label rate on file, only a typical rate/);
    }
  });
});
