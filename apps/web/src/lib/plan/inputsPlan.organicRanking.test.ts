import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  cropPluginSchema,
  fertilizerPluginSchema,
  type CropPlugin,
  type FertilizerPlugin,
  type HerbicidePlugin
} from '$lib/plugins/schemas';
import type { FertilityApproach, Philosophy, SeasonSetup } from '$lib/season/setup';

import { planInputs, type InputsPlanApplication, type InputsPlanInput } from './inputsPlan';
import { noCompliantReasonText } from './inputsReason';

const PLUGINS = path.resolve(__dirname, '../../../../../plugins');
const MAY_1 = Date.UTC(2026, 4, 1);

const library = readdirSync(path.join(PLUGINS, 'fertilizers'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(path.join(PLUGINS, 'fertilizers', f), 'utf8')))
  .map((j) => fertilizerPluginSchema.safeParse(j))
  .filter((r) => r.success)
  .map((r) => r.data as FertilizerPlugin);

// Corn without its sourced fertility block and N need (#739 N739-4 and
// N739-5 drop the family sidedress for it), so these ranking tests keep a
// pre-plant and a sidedress slot.
const corn = {
  ...(cropPluginSchema.parse(
    JSON.parse(readFileSync(path.join(PLUGINS, 'crops', 'corn.json'), 'utf8'))
  ) as CropPlugin),
  fertility: undefined,
  nitrogenNeedLbPerAcre: undefined
} as CropPlugin;

const setup = (philosophy: Philosophy, fertilityApproach: FertilityApproach): SeasonSetup => ({
  philosophy,
  weedStrategy: 'post-emergence-ok',
  pestStrategy: 'preventive',
  fertilityApproach,
  coverCropIntent: 'none',
  transitioningStartedYear: null,
  year: 2026,
  setAt: 0
});

function plan(
  philosophy: Philosophy,
  approach: FertilityApproach,
  fertilizers: FertilizerPlugin[],
  extra: Partial<InputsPlanInput> = {}
) {
  return planInputs({
    plantings: [
      {
        id: 'p1',
        blockId: 'b1',
        cropPluginId: 'corn',
        varietyDisplayName: 'corn',
        plantingDate: MAY_1
      }
    ],
    blocks: [
      {
        id: 'b1',
        name: 'b1',
        acres: 1,
        blockLabel: 'b1',
        tillageMethod: 'conventional',
        axesLocked: false
      }
    ],
    cropPlugins: { corn },
    seasonSetup: setup(philosophy, approach),
    soilTests: [],
    fertilityCredits: [],
    productPlugins: { herbicides: [], insecticides: [], fertilizers, fungicides: [] },
    existingStock: [],
    year: 2026,
    nowMs: 0,
    ...extra
  });
}

const fertilizerApps = (p: { applications: InputsPlanApplication[] }) =>
  p.applications.filter((a) => a.productCategory === 'fertilizer');

const optionIds = (p: { applications: InputsPlanApplication[] }) =>
  p.applications.map((a) => [a.slot, a.productPluginId, (a.options ?? []).map((o) => o.pluginId)]);

function fertilizer(
  pluginId: string,
  n: number,
  flags: NonNullable<FertilizerPlugin['complianceFlags']>,
  organic = true
): FertilizerPlugin {
  return {
    type: 'fertilizer',
    pluginId,
    displayName: pluginId,
    version: '1',
    analysis: { n, p: 1, k: 1 },
    form: 'granular',
    organic,
    complianceFlags: flags
  } as FertilizerPlugin;
}

const SOURCED = { certifiedOrganicAllowed: true, transitioningAllowed: true } as const;

describe('W842-3: a product with an organic condition ranks after one without', () => {
  it('a compost-approach transitioning plan with nothing on hand picks Suståne, not sodium nitrate', () => {
    const p = plan('organic-transitioning', 'compost-amendments', library);
    const apps = fertilizerApps(p);
    expect(apps.map((a) => a.slot).sort()).toEqual(['pre-plant-fertility', 'sidedress-n']);
    for (const app of apps) {
      expect(app.productPluginId).toBe('sustane-pelleted-poultry-4-6-4');
      expect(app.options?.[0].organicCondition).toBeUndefined();
      const nitrate = app.options?.find((o) => o.pluginId === 'chilean-nitrate-16-0-0');
      expect(nitrate?.organicCondition).toMatch(/20% of the crop's total nitrogen requirement/);
      expect(nitrate?.organicMark).toBeUndefined();
    }
  });

  it('still picks a conditioned product, and shows its condition, when only those fit', () => {
    const only = fertilizer('nitrate', 16, { ...SOURCED, notes: 'No more than 20% of crop N.' });
    for (const app of fertilizerApps(plan('organic-transitioning', 'compost-amendments', [only]))) {
      expect(app.productPluginId).toBe('nitrate');
      expect(app.options?.[0].organicCondition).toBe('No more than 20% of crop N.');
    }
  });

  it('puts an unconditioned product to buy ahead of a conditioned one on hand', () => {
    const conditioned = fertilizer('nitrate', 16, { ...SOURCED, notes: 'A condition.' });
    const free = fertilizer('poultry', 4, SOURCED);
    const p = plan('organic-transitioning', 'compost-amendments', [conditioned, free], {
      existingStock: [
        {
          pluginId: 'nitrate',
          category: 'fertilizer',
          displayName: 'nitrate',
          defaultUnit: 'lb',
          onHand: 100000
        }
      ]
    });
    for (const app of fertilizerApps(p)) {
      expect(app.productPluginId).toBe('poultry');
      expect(app.options?.map((o) => o.pluginId)).toEqual(['poultry', 'nitrate']);
    }
  });

  it('stock kept in a unit the rate cannot convert reads as some on hand, and the list says so', () => {
    const a = fertilizer('a-high-n', 12, SOURCED);
    const b = fertilizer('b-low-n', 4, SOURCED);
    const p = plan('organic-transitioning', 'compost-amendments', [a, b], {
      existingStock: [
        {
          pluginId: 'b-low-n',
          category: 'fertilizer',
          displayName: 'b-low-n',
          defaultUnit: 'bag',
          onHand: 3
        }
      ]
    });
    const sidedress = p.applications.find((x) => x.slot === 'sidedress-n')!;
    expect(sidedress.productPluginId).toBe('b-low-n');
    expect(sidedress.productSource).toBe('data');
    expect(sidedress.options?.[0]).toMatchObject({ pluginId: 'b-low-n', stock: 'some' });
    const item = p.shoppingList.find((i) => i.pluginId === 'b-low-n')!;
    expect(item).toMatchObject({ onHand: 0, stockUnitMismatch: 'bag', stockOnHandInStockUnit: 3 });
  });

  it('keeps the stock rank, then the preference order, among products alike on condition', () => {
    const a = fertilizer('a-high-n', 12, SOURCED);
    const b = fertilizer('b-low-n', 4, SOURCED);
    const none = plan('organic-transitioning', 'compost-amendments', [b, a]);
    const sidedress = none.applications.find((x) => x.slot === 'sidedress-n')!;
    expect(sidedress.options?.map((o) => o.pluginId)).toEqual(['a-high-n', 'b-low-n']);
    const held = plan('organic-transitioning', 'compost-amendments', [b, a], {
      existingStock: [
        {
          pluginId: 'b-low-n',
          category: 'fertilizer',
          displayName: 'b-low-n',
          defaultUnit: 'lb',
          onHand: 100000
        }
      ]
    });
    expect(held.applications.find((x) => x.slot === 'sidedress-n')!.productPluginId).toBe(
      'b-low-n'
    );
  });

  it('property: no unconditioned ranked candidate sits below a conditioned one', () => {
    const fertArb = fc.record({
      n: fc.integer({ min: 1, max: 20 }),
      organic: fc.boolean(),
      mark: fc.constantFrom('sourced', 'omri', 'unmarked', 'not-allowed'),
      notes: fc.option(fc.constantFrom('A condition.', 'Another condition.'), { nil: undefined }),
      onHand: fc.constantFrom(0, 5, 100000)
    });
    fc.assert(
      fc.property(
        fc.array(fertArb, { minLength: 1, maxLength: 8 }),
        fc.constantFrom<Philosophy>('organic-transitioning', 'certified-organic'),
        fc.constantFrom<FertilityApproach>(
          'synthetic',
          'compost-amendments',
          'cover-crop-credits',
          'mixed'
        ),
        (specs, philosophy, approach) => {
          const fertilizers = specs.map((s, i) =>
            fertilizer(
              `f${i}`,
              s.n,
              {
                ...(s.mark === 'sourced' ? SOURCED : {}),
                ...(s.mark === 'omri' ? { omriListed: true, transitioningAllowed: true } : {}),
                ...(s.mark === 'not-allowed' ? { certifiedOrganicAllowed: false } : {}),
                ...(s.notes ? { notes: s.notes } : {})
              },
              s.organic
            )
          );
          const existingStock = specs
            .map((s, i) => ({
              pluginId: `f${i}`,
              category: 'fertilizer',
              displayName: `f${i}`,
              defaultUnit: 'lb',
              onHand: s.onHand
            }))
            .filter((s) => s.onHand > 0);
          const p = plan(philosophy, approach, fertilizers, { existingStock });
          for (const app of fertilizerApps(p)) {
            const options = app.options ?? [];
            const firstByHand = options.findIndex((o) => o.organicMark === 'not-marked');
            const ranked = firstByHand < 0 ? options : options.slice(0, firstByHand);
            expect(options.slice(ranked.length).every((o) => o.organicMark)).toBe(true);
            const firstConditioned = ranked.findIndex((o) => o.organicCondition);
            if (firstConditioned >= 0) {
              expect(ranked.slice(firstConditioned).every((o) => o.organicCondition)).toBe(true);
            }
            if (ranked.length > 0) expect(app.productPluginId).toBe(ranked[0].pluginId);
            else expect(app.productPluginId).toBeNull();
          }
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('W842-3: rankings outside organic seasons do not change', () => {
  const stripNotes = (f: FertilizerPlugin): FertilizerPlugin =>
    f.complianceFlags
      ? ({
          ...f,
          complianceFlags: { ...f.complianceFlags, notes: undefined }
        } as FertilizerPlugin)
      : f;

  for (const philosophy of ['conventional', 'no-till', 'non-gmo'] as const) {
    for (const approach of ['synthetic', 'compost-amendments', 'mixed'] as const) {
      it(`${philosophy} / ${approach}: condition notes never reorder the library`, () => {
        const withNotes = plan(philosophy, approach, library);
        expect(fertilizerApps(withNotes).length).toBeGreaterThan(0);
        expect(
          fertilizerApps(withNotes).every((a) => a.options?.every((o) => !o.organicCondition))
        ).toBe(true);
        expect(optionIds(withNotes)).toEqual(
          optionIds(plan(philosophy, approach, library.map(stripNotes)))
        );
      });
    }
  }

  it('conventional compost-approach corn still starts with the highest-N organic-source product', () => {
    const p = plan('conventional', 'compost-amendments', library);
    expect(p.applications.find((a) => a.slot === 'sidedress-n')!.productPluginId).toBe(
      'chilean-nitrate-16-0-0'
    );
  });

  it('pesticide options carry no organic condition in an organic season', () => {
    const herbicide = {
      type: 'herbicide',
      pluginId: 'soap',
      displayName: 'soap',
      version: '1',
      activeIngredients: [{ name: 'soap', chemistryClass: 'glufosinate' }],
      ratePerAcre: { amount: 2, unit: 'pt' },
      gpaCalibration: 15,
      complianceFlags: { omriListed: true, transitioningAllowed: true, notes: 'A condition.' }
    } as unknown as HerbicidePlugin;
    const plain = { ...herbicide, pluginId: 'plain', displayName: 'plain' } as HerbicidePlugin;
    plain.complianceFlags = { omriListed: true, transitioningAllowed: true };
    const crop = {
      ...corn,
      sprayWindows: [
        {
          chemistryClass: 'glufosinate',
          purpose: 'pre-emergent',
          anchor: 'planting',
          offsetDaysMin: 0,
          offsetDaysMax: 7,
          title: 'Weed control'
        }
      ]
    } as unknown as CropPlugin;
    const p = plan('organic-transitioning', 'compost-amendments', library, {
      cropPlugins: { corn: crop },
      productPlugins: {
        herbicides: [herbicide, plain],
        insecticides: [],
        fertilizers: library,
        fungicides: []
      }
    });
    const app = p.applications.find((a) => a.slot === 'pre-emergent')!;
    expect(app.productPluginId).toBe('soap');
    expect(app.options?.map((o) => [o.pluginId, o.organicCondition])).toEqual([
      ['soap', undefined],
      ['plain', undefined]
    ]);
  });
});

describe('W842-2: empty-pool reasons name the library mark', () => {
  const urea = fertilizer('urea', 46, { certifiedOrganicAllowed: false }, false);

  it('says what the library marks, without "compliant" or "catalog"', () => {
    const p = plan('certified-organic', 'compost-amendments', [urea]);
    const reasons = p.warnings.flatMap((w) =>
      w.kind === 'no-compliant-product' ? [[w.slot, w.reason]] : []
    );
    expect(reasons).toContainEqual([
      'pre-plant-fertility',
      'No fertilizer in our library is marked for certified organic and fits your fertility approach (compost, manure & natural amendments).'
    ]);
    expect(reasons).toContainEqual([
      'sidedress-n',
      'No high-nitrogen fertilizer in our library is marked for certified organic for sidedress.'
    ]);
    for (const [, reason] of reasons) {
      expect(reason).not.toMatch(/compliant|catalog/);
      expect(reason.endsWith('.')).toBe(true);
    }
  });

  it('builds the same reason in Spanish from its code, keeping each kind apart', () => {
    const p = plan('certified-organic', 'compost-amendments', [urea]);
    const ws = p.warnings.filter(
      (w): w is Extract<typeof w, { kind: 'no-compliant-product' }> =>
        w.kind === 'no-compliant-product'
    );
    const setup = { philosophy: 'certified-organic', fertilityApproach: 'compost-amendments' };
    for (const w of ws) {
      expect(noCompliantReasonText(w, setup)).toBe(w.reason);
    }
    const approach = ws.find((w) => w.reasonCode === 'approach')!;
    expect(noCompliantReasonText(approach, setup, 'es')).toBe(
      'Ningún fertilizante de nuestra biblioteca está marcado para el enfoque orgánico certificado y sirve para tu enfoque de fertilidad (composta, estiércol y enmiendas naturales).'
    );
    const es = new Set(
      (['approach', 'sidedress', 'topdress', 'cover-terminate'] as const).map((reasonCode) =>
        noCompliantReasonText({ slot: 'sidedress-n', reasonCode }, setup, 'es')
      )
    );
    expect(es.size).toBe(4);
    for (const text of es) expect(text).not.toMatch(/certified-organic|compost-amendments/);
  });
});
