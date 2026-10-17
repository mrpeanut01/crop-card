import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cropPluginSchema,
  herbicidePluginSchema,
  type CropPlugin,
  type HerbicidePlugin
} from '$lib/plugins/schemas';
import { herbicideSafeOnCrop, type InputsPlan, type InputsPlanInput } from '$lib/plan/inputsPlan';
import { validateManualChoices } from './inputsChoiceValidate';
import { validateAiPlan } from './aiInputsPlan';

const PLUGINS = path.resolve(__dirname, '../../../../../plugins');

const glyphosate = herbicidePluginSchema.parse(
  JSON.parse(readFileSync(path.join(PLUGINS, 'herbicides', 'glyphosate-4-plus.json'), 'utf8'))
) as HerbicidePlugin;
const rrSoy = cropPluginSchema.parse(
  JSON.parse(
    readFileSync(path.join(PLUGINS, 'crops', 'soybean-asgrow-roundup-ready-2-xtend.json'), 'utf8')
  )
) as CropPlugin;
const plainSoy = { ...rrSoy, traits: [] } as CropPlugin;
const rate = glyphosate.ratePerAcre ?? null;

function manual(crop: CropPlugin) {
  return validateManualChoices(
    [
      {
        id: 'a',
        slot: 'post-emergent',
        cropPluginId: crop.pluginId,
        productPluginId: glyphosate.pluginId,
        productCategory: 'herbicide',
        rateAmount: rate?.amount ?? null,
        rateUnit: rate?.unit ?? null,
        productSource: 'manual'
      }
    ],
    {
      products: new Map([[glyphosate.pluginId, glyphosate]]),
      cropPlugins: { [crop.pluginId]: crop },
      philosophy: 'conventional'
    }
  );
}

function aiViolations(crop: CropPlugin) {
  const input = {
    plantings: [],
    blocks: [],
    cropPlugins: { [crop.pluginId]: crop },
    seasonSetup: { philosophy: 'conventional', fertilityApproach: 'synthetic' },
    soilTests: [],
    fertilityCredits: [],
    productPlugins: { herbicides: [glyphosate], insecticides: [], fertilizers: [], fungicides: [] },
    existingStock: [],
    year: 2026
  } as unknown as InputsPlanInput;
  const plan = {
    applications: [
      {
        id: 'a1',
        plantingId: 'p1',
        blockId: 'b1',
        cropPluginId: crop.pluginId,
        slot: 'post-emergent',
        productPluginId: glyphosate.pluginId,
        productDisplayName: glyphosate.displayName,
        productCategory: 'herbicide',
        windowStartMs: 0,
        windowEndMs: 0,
        applicationDateMs: 0,
        rateAmount: rate?.amount ?? null,
        rateUnit: rate?.unit ?? null,
        acres: 1,
        totalAmount: rate?.amount ?? null,
        rationale: ''
      }
    ],
    scoutTasks: [],
    shoppingList: [],
    warnings: [],
    meta: {}
  } as unknown as InputsPlan;
  return validateAiPlan(plan, input).violations;
}

describe('the Roundup Ready trait claim holds in every inputs re-check (#835)', () => {
  it('the planner offers glyphosate only on the trait soybean', () => {
    expect(herbicideSafeOnCrop(glyphosate, rrSoy)).toBe(true);
    expect(herbicideSafeOnCrop(glyphosate, plainSoy)).toBe(false);
  });

  it('the commit re-check accepts glyphosate on the Roundup Ready soybean', () => {
    expect(manual(rrSoy)).toEqual([]);
  });

  it('the commit re-check still refuses glyphosate on a soybean without the trait', () => {
    expect(manual(plainSoy)).toEqual([expect.stringMatching(/would harm/)]);
  });

  it('the AI validator accepts glyphosate on the Roundup Ready soybean', () => {
    expect(aiViolations(rrSoy)).toEqual([]);
  });

  it('the AI validator still flags glyphosate on a soybean without the trait', () => {
    expect(aiViolations(plainSoy)).toEqual(['crop-incompatible:a1:CROP_INCOMPATIBLE']);
  });
});
