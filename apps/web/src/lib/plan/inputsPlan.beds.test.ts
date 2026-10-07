import { describe, expect, it } from 'vitest';

import type { Block } from '$lib/db/blocks';
import type {
  CropPlugin,
  CropSprayWindow,
  FertilizerPlugin,
  HerbicidePlugin
} from '$lib/plugins/schemas';
import type { CropFamily } from '$lib/safety/cropFamilyLethality';
import type { SeasonSetup } from '$lib/season/setup';

import { planInputs, type InputsPlanInput } from './inputsPlan';
import { buildShoppingList } from './inputsChoice';

const DAY = 24 * 60 * 60 * 1000;
const MAY = Date.UTC(2026, 4, 1);

function setup(overrides: Partial<SeasonSetup> = {}): SeasonSetup {
  return {
    philosophy: 'conventional',
    weedStrategy: 'post-emergence-ok',
    pestStrategy: 'ipm',
    fertilityApproach: 'mixed',
    coverCropIntent: 'none',
    transitioningStartedYear: null,
    year: 2026,
    setAt: 0,
    ...overrides
  };
}

function block(id: string, acres = 0.01): Block {
  return {
    id,
    name: id,
    acres,
    blockLabel: id,
    tillageMethod: 'conventional',
    axesLocked: false
  };
}

function crop(family: CropFamily, pluginId: string, extras: Partial<CropPlugin> = {}): CropPlugin {
  return {
    type: 'crop',
    pluginId,
    displayName: pluginId,
    version: '1',
    cropFamily: family,
    ...extras
  } as CropPlugin;
}

function fertilizer(
  pluginId: string,
  analysis: { n: number; p: number; k: number },
  organic: boolean,
  form: 'granular' | 'liquid' = 'granular'
): FertilizerPlugin {
  return {
    type: 'fertilizer',
    pluginId,
    displayName: pluginId,
    version: '1',
    analysis,
    form,
    organic
  } as FertilizerPlugin;
}

function herbicide(pluginId: string, chemistryClass: string): HerbicidePlugin {
  return {
    type: 'herbicide',
    pluginId,
    displayName: pluginId,
    version: '1',
    activeIngredients: [{ name: pluginId, chemistryClass: chemistryClass as never }],
    ratePerAcre: { amount: 1, unit: 'pt' },
    gpaCalibration: 15
  } as HerbicidePlugin;
}

function input(overrides: Partial<InputsPlanInput> = {}): InputsPlanInput {
  return {
    plantings: [],
    blocks: [],
    cropPlugins: {},
    seasonSetup: setup(),
    soilTests: [],
    fertilityCredits: [],
    productPlugins: {
      herbicides: [],
      insecticides: [],
      fungicides: [],
      fertilizers: [
        fertilizer('compost', { n: 1, p: 1, k: 1 }, true),
        fertilizer('triple-ten', { n: 10, p: 10, k: 10 }, false)
      ]
    },
    existingStock: [],
    year: 2026,
    nowMs: 0,
    ...overrides
  };
}

describe('#710 one bed, many plantings', () => {
  const lettuce = crop('leafy-green', 'lettuce');
  const carrot = crop('root', 'carrot');
  const plantings = [
    {
      id: 'l1',
      blockId: 'b1',
      cropPluginId: 'lettuce',
      varietyDisplayName: 'Lettuce',
      plantingDate: MAY
    },
    {
      id: 'l2',
      blockId: 'b1',
      cropPluginId: 'lettuce',
      varietyDisplayName: 'Lettuce',
      plantingDate: MAY + 14 * DAY
    },
    {
      id: 'c1',
      blockId: 'b1',
      cropPluginId: 'carrot',
      varietyDisplayName: 'Carrot',
      plantingDate: MAY - 7 * DAY
    },
    {
      id: 'c2',
      blockId: 'b1',
      cropPluginId: 'carrot',
      varietyDisplayName: 'Carrot',
      plantingDate: MAY + 21 * DAY
    },
    {
      id: 'x1',
      blockId: 'b2',
      cropPluginId: 'lettuce',
      varietyDisplayName: 'Lettuce',
      plantingDate: MAY
    }
  ];
  const base = input({
    plantings,
    blocks: [block('b1'), block('b2')],
    cropPlugins: { lettuce, carrot }
  });

  it('plans pre-plant fertility once per bed, before its first planting', () => {
    const plan = planInputs(base);
    const pre = plan.applications.filter((a) => a.slot === 'pre-plant-fertility');
    expect(pre.map((a) => a.blockId).sort()).toEqual(['b1', 'b2']);
    const b1 = pre.find((a) => a.blockId === 'b1')!;
    expect(b1.windowEndMs).toBe(MAY - 7 * DAY - 7 * DAY);
    expect([...(b1.coversPlantingIds ?? [])].sort()).toEqual(['c1', 'c2', 'l1', 'l2']);
    expect(b1.rationale).toContain('leafy-green');
    expect(b1.rationale).toContain('root');
  });

  it('sizes the bed for the hungriest family in it, never the sum', () => {
    const plan = planInputs(base);
    const b1 = plan.applications.find(
      (a) => a.slot === 'pre-plant-fertility' && a.blockId === 'b1'
    )!;
    const lettuceOnly = planInputs(
      input({
        plantings: [plantings[0]],
        blocks: [block('b1')],
        cropPlugins: { lettuce }
      })
    ).applications.find((a) => a.slot === 'pre-plant-fertility')!;
    const carrotOnly = planInputs(
      input({
        plantings: [plantings[2]],
        blocks: [block('b1')],
        cropPlugins: { carrot }
      })
    ).applications.find((a) => a.slot === 'pre-plant-fertility')!;
    expect(b1.totalAmount).toBe(
      Math.max(lettuceOnly.totalAmount ?? 0, carrotOnly.totalAmount ?? 0)
    );
  });

  it('merges scout reminders per bed and pest list', () => {
    const plan = planInputs(base);
    const b1 = plan.scoutTasks.filter((s) => s.blockId === 'b1');
    expect(b1).toHaveLength(2);
    const lettuceScout = b1.find((s) => s.cropPluginId === 'lettuce')!;
    expect(lettuceScout.windowStartMs).toBe(MAY + 14 * DAY);
    expect(lettuceScout.windowEndMs).toBeGreaterThan(MAY + 14 * DAY + 45 * DAY - 1);
    expect(lettuceScout.title.match(/Lettuce/g)).toHaveLength(1);
  });

  it('terminates a cover crop once per bed', () => {
    const plan = planInputs({
      ...base,
      seasonSetup: setup({ coverCropIntent: 'fall-cereal' })
    });
    const terminate = plan.applications.filter((a) => a.slot === 'cover-terminate');
    expect(terminate.map((a) => a.plantingId).sort()).toEqual(['c1', 'x1']);
  });
});

describe('#720 honest gaps', () => {
  const wheat = crop('cereal-grain' as CropFamily, 'wheat');
  const corn = crop('corn', 'corn', {
    sprayWindows: [
      {
        chemistryClass: 'synthetic-auxin',
        anchor: 'stage',
        stageCode: 'V2',
        offsetDaysMin: 0,
        offsetDaysMax: 4,
        title: 'POST',
        purpose: 'post-emergent'
      } as CropSprayWindow,
      {
        chemistryClass: 'hppd-inhibitor',
        anchor: 'stage',
        stageCode: 'V4',
        offsetDaysMin: 0,
        offsetDaysMax: 4,
        title: 'POST 2',
        purpose: 'post-emergent'
      } as CropSprayWindow
    ]
  });
  const plantings = [
    {
      id: 'w1',
      blockId: 'b1',
      cropPluginId: 'wheat',
      varietyDisplayName: 'Wheat',
      plantingDate: MAY
    },
    {
      id: 'w2',
      blockId: 'b2',
      cropPluginId: 'wheat',
      varietyDisplayName: 'Wheat',
      plantingDate: MAY
    },
    {
      id: 'k1',
      blockId: 'b3',
      cropPluginId: 'corn',
      varietyDisplayName: 'Corn',
      plantingDate: MAY
    },
    { id: 'k2', blockId: 'b4', cropPluginId: 'corn', varietyDisplayName: 'Corn', plantingDate: MAY }
  ];
  const base = input({
    plantings,
    blocks: [block('b1'), block('b2'), block('b3'), block('b4')],
    cropPlugins: { wheat, corn },
    productPlugins: {
      herbicides: [herbicide('auxin', 'synthetic-auxin')],
      insecticides: [],
      fungicides: [],
      fertilizers: [fertilizer('triple-ten', { n: 10, p: 10, k: 10 }, false)]
    }
  });

  it('names crops with no herbicide timing in one warning', () => {
    const plan = planInputs(base);
    const w = plan.warnings.filter((x) => x.kind === 'no-herbicide-timing');
    expect(w).toHaveLength(1);
    expect(w[0].kind === 'no-herbicide-timing' && w[0].plantingIds).toEqual(['w1', 'w2']);
    expect(plan.applications.some((a) => a.productCategory === 'herbicide')).toBe(false);
  });

  it('says nothing about herbicide timing on a cultivate-first farm', () => {
    const plan = planInputs({ ...base, seasonSetup: setup({ weedStrategy: 'cultivate-first' }) });
    expect(plan.warnings.some((x) => x.kind === 'no-herbicide-timing')).toBe(false);
  });

  it('warns once per crop about a missing yield default or stage table', () => {
    const plan = planInputs(base);
    expect(plan.warnings.filter((x) => x.kind === 'missing-yield-goal')).toHaveLength(1);
    expect(plan.warnings.filter((x) => x.kind === 'no-growth-stage-table')).toHaveLength(1);
  });

  it('never plans a post-emergent herbicide for a pre-emergence-only farm', () => {
    const staged = crop('corn', 'corn', {
      sprayWindows: [
        {
          chemistryClass: 'synthetic-auxin',
          anchor: 'planting',
          offsetDaysMin: 20,
          offsetDaysMax: 30,
          title: 'POST',
          purpose: 'post-emergent'
        } as CropSprayWindow
      ]
    });
    const post = { ...base, cropPlugins: { wheat, corn: staged } };
    expect(planInputs(post).applications.some((a) => a.slot === 'post-emergent')).toBe(true);
    const preOnly = planInputs({
      ...post,
      seasonSetup: setup({ weedStrategy: 'pre-emergence-ok' })
    });
    expect(preOnly.applications.some((a) => a.slot === 'post-emergent')).toBe(false);
  });
});

describe('#721 fertilizer approach and units', () => {
  const corn = crop('corn', 'corn');
  const plantings = [
    { id: 'k1', blockId: 'b1', cropPluginId: 'corn', varietyDisplayName: 'Corn', plantingDate: MAY }
  ];
  const fertilizers = [
    fertilizer('bat-guano', { n: 7, p: 3, k: 1 }, true),
    fertilizer('uan-32', { n: 32, p: 0, k: 0 }, false, 'liquid'),
    fertilizer('triple-ten', { n: 10, p: 10, k: 10 }, false)
  ];

  it('offers only non-organic fertilizers under the synthetic approach', () => {
    const plan = planInputs(
      input({
        plantings,
        blocks: [block('b1', 1)],
        cropPlugins: { corn },
        seasonSetup: setup({ fertilityApproach: 'synthetic' }),
        productPlugins: { herbicides: [], insecticides: [], fungicides: [], fertilizers }
      })
    );
    const fert = plan.applications.filter((a) => a.productCategory === 'fertilizer');
    expect(fert.length).toBeGreaterThan(0);
    for (const a of fert) {
      expect(a.options?.some((o) => o.pluginId === 'bat-guano')).toBe(false);
    }
  });

  it('keeps organic fertilizers for a mixed approach', () => {
    const plan = planInputs(
      input({
        plantings,
        blocks: [block('b1', 1)],
        cropPlugins: { corn },
        seasonSetup: setup({ fertilityApproach: 'mixed' }),
        productPlugins: { herbicides: [], insecticides: [], fungicides: [], fertilizers }
      })
    );
    const pre = plan.applications.find((a) => a.slot === 'pre-plant-fertility')!;
    expect(pre.options?.some((o) => o.pluginId === 'bat-guano')).toBe(true);
  });

  it('shows liquid stock in its own unit instead of none on hand', () => {
    const list = buildShoppingList(
      [
        {
          id: 'a',
          plantingId: 'k1',
          blockId: 'b1',
          cropPluginId: 'corn',
          slot: 'sidedress-n',
          productPluginId: 'uan-32',
          productDisplayName: 'UAN 32%',
          productCategory: 'fertilizer',
          windowStartMs: 0,
          windowEndMs: 0,
          applicationDateMs: 0,
          rateAmount: 125,
          rateUnit: 'lb',
          acres: 10,
          totalAmount: 1250,
          rationale: ''
        }
      ],
      [{ pluginId: 'uan-32', onHand: 500, unit: 'gal' }]
    );
    expect(list[0].stockUnitMismatch).toBe('gal');
    expect(list[0].stockOnHandInStockUnit).toBe(500);
  });
});
