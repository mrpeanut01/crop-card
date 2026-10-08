import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { InputsPlan, InputsPlanInput } from '$lib/plan/inputsPlan';
import { applySubstitutions, validateAiPlan } from './aiInputsPlan';

const herbicide = {
  type: 'herbicide',
  pluginId: 'two-four-d',
  displayName: '2,4-D Amine',
  activeIngredients: [{ name: '2,4-D', chemistryClass: 'synthetic-auxin' }],
  ratePerAcre: { amount: 32, unit: 'fl-oz' },
  rateProvenance: 'label',
  complianceFlags: {}
};
const fungicide = {
  type: 'fungicide',
  pluginId: 'copper',
  displayName: 'Copper',
  activeIngredients: [{ name: 'copper', fracGroup: 'M01' }],
  ratePerAcre: { amount: 2, unit: 'lb' },
  complianceFlags: {}
};

const input = {
  plantings: [],
  blocks: [],
  cropPlugins: {
    beans: { type: 'crop', pluginId: 'beans', displayName: 'Beans', cropFamily: 'legume' }
  },
  seasonSetup: { philosophy: 'conventional', fertilityApproach: 'synthetic' },
  soilTests: [],
  fertilityCredits: [],
  productPlugins: {
    herbicides: [herbicide],
    insecticides: [],
    fertilizers: [],
    fungicides: [fungicide]
  },
  existingStock: [],
  year: 2026
} as unknown as InputsPlanInput;

function planWith(app: Partial<InputsPlan['applications'][number]>): InputsPlan {
  return {
    applications: [
      {
        id: 'a1',
        plantingId: 'p1',
        blockId: 'b1',
        cropPluginId: 'beans',
        slot: 'disease-protectant',
        productPluginId: 'copper',
        productDisplayName: 'Copper',
        productCategory: 'fungicide',
        windowStartMs: 0,
        windowEndMs: 0,
        applicationDateMs: 0,
        rateAmount: 2,
        rateUnit: 'lb',
        acres: 1,
        totalAmount: 2,
        rationale: '',
        ...app
      } as InputsPlan['applications'][number]
    ],
    scoutTasks: [],
    shoppingList: [],
    warnings: [],
    meta: {} as InputsPlan['meta']
  };
}

describe('aiInputsPlan validator holes', () => {
  it('passes the deterministic fungicide at label rate', () => {
    expect(validateAiPlan(planWith({}), input).ok).toBe(true);
  });

  it('refuses a herbicide substituted into a fungicide slot (skips crop compatibility)', () => {
    const v = validateAiPlan(
      planWith({ productPluginId: 'two-four-d', rateAmount: 16, rateUnit: 'fl-oz' }),
      input
    );
    expect(v.ok).toBe(false);
    expect(v.violations[0]).toMatch(/^category-mismatch:/);
  });

  it('converts units before the rate ceiling: 2 qt is over a 32 fl-oz ceiling', () => {
    const v = validateAiPlan(
      planWith({
        productPluginId: 'two-four-d',
        productCategory: 'herbicide',
        slot: 'burndown',
        cropPluginId: 'none',
        rateAmount: 2,
        rateUnit: 'qt'
      }),
      input
    );
    expect(v.violations).toEqual([expect.stringMatching(/^rate-over-ceiling:/)]);
  });

  it('refuses a unit that cannot be converted and a rate not above zero', () => {
    expect(validateAiPlan(planWith({ rateAmount: 1, rateUnit: 'gal' }), input).violations).toEqual([
      expect.stringMatching(/^rate-unit-mismatch:/)
    ]);
    expect(validateAiPlan(planWith({ rateAmount: -1 }), input).violations).toEqual([
      expect.stringMatching(/^rate-not-positive:/)
    ]);
  });

  it('refuses a rate for a herbicide with no label rate on file (#737)', () => {
    const noRate = { ...herbicide, pluginId: 'no-rate', ratePerAcre: undefined };
    const noRateInput = {
      ...input,
      productPlugins: { ...input.productPlugins, herbicides: [herbicide, noRate] }
    } as unknown as InputsPlanInput;
    const v = validateAiPlan(
      planWith({
        productPluginId: 'no-rate',
        productCategory: 'herbicide',
        slot: 'burndown',
        cropPluginId: 'none',
        rateAmount: 1,
        rateUnit: 'pt'
      }),
      noRateInput
    );
    expect(v.violations).toEqual([expect.stringMatching(/^rate-not-on-file:/)]);
  });

  it("names the substituted product from the catalog, never from Claude's text", () => {
    const out = applySubstitutions(
      planWith({ productPluginId: null, productDisplayName: null }),
      [
        {
          applicationId: 'a1',
          productPluginId: 'copper',
          productDisplayName: 'Organic Neem Oil',
          rateAmount: 1,
          rateUnit: 'lb',
          rationale: 'r'
        }
      ],
      input
    );
    expect(out.applications[0].productDisplayName).toBe('Copper');
  });

  describe('a typical (fallback) herbicide rate is never a ceiling (#737 swarm 2026-10-07)', () => {
    const typical = { ...herbicide, pluginId: 'typical', rateProvenance: 'fallback' };
    const typicalInput = {
      ...input,
      productPlugins: { ...input.productPlugins, herbicides: [herbicide, typical] }
    } as unknown as InputsPlanInput;
    const at = (rateAmount: number, rateUnit = 'fl-oz') =>
      validateAiPlan(
        planWith({
          productPluginId: 'typical',
          productCategory: 'herbicide',
          slot: 'burndown',
          cropPluginId: 'none',
          rateAmount,
          rateUnit
        }),
        typicalInput
      );

    it('keeps the typical rate as it is, in any convertible unit', () => {
      expect(at(32).ok).toBe(true);
      expect(at(2, 'pt').ok).toBe(true);
    });

    it('refuses any other rate, below or above, as not from the label', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0.01, max: 500, noNaN: true }).filter((n) => Math.abs(n - 32) > 1e-3),
          (rate) => {
            expect(at(rate).violations).toEqual([expect.stringMatching(/^rate-not-from-label:/)]);
          }
        )
      );
    });

    it('a herbicide with no rateProvenance is read as typical too', () => {
      const bare = { ...herbicide, pluginId: 'bare', rateProvenance: undefined };
      const bareInput = {
        ...input,
        productPlugins: { ...input.productPlugins, herbicides: [bare] }
      } as unknown as InputsPlanInput;
      const v = validateAiPlan(
        planWith({
          productPluginId: 'bare',
          productCategory: 'herbicide',
          slot: 'burndown',
          cropPluginId: 'none',
          rateAmount: 16,
          rateUnit: 'fl-oz'
        }),
        bareInput
      );
      expect(v.violations).toEqual([expect.stringMatching(/^rate-not-from-label:/)]);
    });

    it('tags an AI substitution with the product rate provenance', () => {
      const out = applySubstitutions(
        planWith({ productPluginId: null, productCategory: 'herbicide', slot: 'burndown' }),
        [
          {
            applicationId: 'a1',
            productPluginId: 'typical',
            productDisplayName: 'x',
            rateAmount: 32,
            rateUnit: 'fl-oz',
            rationale: 'r'
          }
        ],
        typicalInput
      );
      expect(out.applications[0].rateProvenance).toBe('fallback');
    });
  });
});
