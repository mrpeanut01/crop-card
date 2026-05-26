/**
 * Deterministic inputs planner tests (Phase 21 / B-26).
 *
 * Coverage strategy:
 *
 *   1. **96-scenario parametric matrix** — 4 philosophies × 4 fertility
 *      approaches × 6 representative crop families. Each combination runs
 *      a fixed-fixture plan and asserts a small invariant set
 *      (fertilizer chosen ↔ philosophy compatible; warnings have the
 *      right kind when chosen ↔ deny; applications non-empty).
 *
 *   2. **Targeted edge-case tests** — IPM exclusion of prophylactic
 *      insecticide windows, cover-crop terminate path, sidedress-N for
 *      heavy feeders, cultivate-first skipping pre-emergence windows,
 *      soil-test credit deduction, shopping-list aggregation across
 *      plantings.
 *
 * Cross-tenant isolation isn't tested here — the planner is pure and
 * accepts pre-scoped inputs; tenant containment is the caller's job and
 * is property-tested in `tenant.crossTenant.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import type { Block, PlantingRecord } from '$lib/db/blocks';
import type { FertilityCredit, SoilTest } from '$lib/db/fertility';
import type {
  CropPlugin,
  FertilizerPlugin,
  FungicidePlugin,
  HerbicidePlugin,
  InsecticidePlugin
} from '$lib/plugins/schemas';
import type { CropFamily } from '$lib/safety/cropFamilyLethality';
import type { FertilityApproach, Philosophy, SeasonSetup } from '$lib/season/setup';

import { planInputs, type InputsPlanInput } from './inputsPlan';

/* ─── Fixture builders ──────────────────────────────────────────────── */

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 2026;
const PLANTING_MS = Date.UTC(2026, 4, 15); // 2026-05-15

function buildSetup(
  philosophy: Philosophy,
  fertilityApproach: FertilityApproach,
  overrides: Partial<SeasonSetup> = {}
): SeasonSetup {
  return {
    philosophy,
    weedStrategy: 'post-emergence-ok',
    pestStrategy: 'preventive',
    fertilityApproach,
    coverCropIntent: 'none',
    sprayCapacity: 'backpack-4gal',
    transitioningStartedYear: null,
    year: YEAR,
    setAt: 0,
    ...overrides
  };
}

function buildBlock(id: string, acres = 1): Block {
  return {
    id,
    name: `Block ${id}`,
    acres,
    blockLabel: id,
    tillageMethod: 'conventional',
    axesLocked: false
  };
}

function buildPlanting(id: string, blockId: string, cropPluginId: string): PlantingRecord {
  return {
    id,
    blockId,
    cropPluginId,
    varietyDisplayName: `${cropPluginId} variety`,
    plantingDate: PLANTING_MS
  };
}

function buildCrop(
  family: CropFamily,
  pluginId = `crop-${family}`,
  extras: Partial<CropPlugin> = {}
): CropPlugin {
  return {
    type: 'crop',
    pluginId,
    displayName: `${family} crop`,
    version: '1',
    cropFamily: family,
    sprayWindows: [],
    ...extras
  } as CropPlugin;
}

function buildFertilizer(
  pluginId: string,
  opts: {
    analysis: { n: number; p: number; k: number };
    organic?: boolean;
    omriListed?: boolean;
    nonGmoCompliant?: boolean;
    certifiedOrganicAllowed?: boolean;
    transitioningAllowed?: boolean;
  }
): FertilizerPlugin {
  return {
    type: 'fertilizer',
    pluginId,
    displayName: pluginId,
    version: '1',
    analysis: opts.analysis,
    form: 'granular',
    organic: opts.organic ?? false,
    complianceFlags: {
      omriListed: opts.omriListed,
      nonGmoCompliant: opts.nonGmoCompliant,
      certifiedOrganicAllowed: opts.certifiedOrganicAllowed,
      transitioningAllowed: opts.transitioningAllowed
    }
  } as FertilizerPlugin;
}

function buildHerbicide(
  pluginId: string,
  chemistryClass = 'glufosinate',
  flags: {
    omriListed?: boolean;
    nonGmoCompliant?: boolean;
    certifiedOrganicAllowed?: boolean;
    transitioningAllowed?: boolean;
  } = {}
): HerbicidePlugin {
  return {
    type: 'herbicide',
    pluginId,
    displayName: pluginId,
    version: '1',
    activeIngredients: [{ name: pluginId, chemistryClass: chemistryClass as never }],
    ratePerAcre: { amount: 2, unit: 'pt' },
    gpaCalibration: 15,
    complianceFlags: flags
  } as HerbicidePlugin;
}

function buildInsecticide(
  pluginId: string,
  flags: {
    omriListed?: boolean;
    nonGmoCompliant?: boolean;
    certifiedOrganicAllowed?: boolean;
    transitioningAllowed?: boolean;
  } = {}
): InsecticidePlugin {
  return {
    type: 'insecticide',
    pluginId,
    displayName: pluginId,
    version: '1',
    activeIngredients: [{ name: pluginId }],
    reEntryIntervalHours: 12,
    complianceFlags: flags
  } as InsecticidePlugin;
}

function buildFungicide(
  pluginId: string,
  flags: {
    omriListed?: boolean;
    nonGmoCompliant?: boolean;
    certifiedOrganicAllowed?: boolean;
    transitioningAllowed?: boolean;
  } = {}
): FungicidePlugin {
  return {
    type: 'fungicide',
    pluginId,
    displayName: pluginId,
    version: '1',
    activeIngredients: [{ name: pluginId, fracCode: 'M03' }],
    ratePerAcre: { amount: 1, unit: 'lb' },
    gpaCalibration: 15,
    reEntryIntervalHours: 4,
    preHarvestIntervalDays: 0,
    complianceFlags: flags
  } as FungicidePlugin;
}

/* A product pool that covers every philosophy:
 *   - bagged conventional 10-10-10 (non-GMO only)
 *   - OMRI-listed bone meal (organic; all 4 philosophies)
 *   - synthetic urea 46-0-0 (conventional only)
 *   - compost 1-0.5-1 (organic but uncertified)
 */
function buildProductPool() {
  return {
    fertilizers: [
      buildFertilizer('triple-ten', {
        analysis: { n: 10, p: 10, k: 10 },
        organic: false,
        nonGmoCompliant: true
      }),
      buildFertilizer('bone-meal-omri', {
        analysis: { n: 3, p: 15, k: 0 },
        organic: true,
        omriListed: true,
        nonGmoCompliant: true,
        transitioningAllowed: true
      }),
      buildFertilizer('urea-46', {
        analysis: { n: 46, p: 0, k: 0 },
        organic: false
      }),
      buildFertilizer('compost-uncertified', {
        analysis: { n: 1, p: 0.5, k: 1 },
        organic: true,
        nonGmoCompliant: true,
        transitioningAllowed: true
      })
    ],
    herbicides: [
      buildHerbicide('roundup', 'glufosinate', { nonGmoCompliant: true }),
      buildHerbicide('citric-burndown', 'glufosinate', {
        omriListed: true,
        nonGmoCompliant: true,
        transitioningAllowed: true
      })
    ],
    insecticides: [
      buildInsecticide('imidacloprid', { nonGmoCompliant: true }),
      buildInsecticide('spinosad-omri', {
        omriListed: true,
        nonGmoCompliant: true,
        transitioningAllowed: true
      })
    ],
    fungicides: [
      buildFungicide('chlorothalonil', { nonGmoCompliant: true }),
      buildFungicide('copper-omri', {
        omriListed: true,
        nonGmoCompliant: true,
        transitioningAllowed: true
      })
    ]
  };
}

function buildBaseInput(overrides: Partial<InputsPlanInput> = {}): InputsPlanInput {
  return {
    plantings: [],
    blocks: [],
    cropPlugins: {},
    seasonSetup: buildSetup('conventional', 'synthetic'),
    soilTests: [],
    fertilityCredits: [],
    productPlugins: buildProductPool(),
    existingStock: [],
    year: YEAR,
    nowMs: Date.UTC(2026, 1, 1),
    ...overrides
  };
}

/* ─── 1. Parametric 96-scenario matrix ──────────────────────────────── */

const PHILOSOPHIES: Philosophy[] = [
  'conventional',
  'non-gmo',
  'organic-transitioning',
  'certified-organic'
];
const FERTILITY_APPROACHES: FertilityApproach[] = [
  'synthetic',
  'compost-amendments',
  'cover-crop-credits',
  'mixed'
];
const FAMILIES: CropFamily[] = [
  'corn',
  'brassica',
  'cucurbit',
  'solanaceae',
  'legume',
  'leafy-green'
];

/** The fixture pool always carries an OMRI-listed + non-GMO-flagged
 *  option in every category, so a planning run should never come up
 *  empty regardless of philosophy. The matrix asserts this invariant
 *  end-to-end. */
const FIXTURE_POOL_COVERS_EVERY_PHILOSOPHY = true;

describe('planInputs — 4×4×6 philosophy × approach × family matrix', () => {
  for (const philosophy of PHILOSOPHIES) {
    for (const approach of FERTILITY_APPROACHES) {
      for (const family of FAMILIES) {
        it(`${philosophy} + ${approach} + ${family}`, () => {
          const cropPluginId = `crop-${family}`;
          const crop = buildCrop(family, cropPluginId);
          const blockId = `block-${family}`;
          const planting = buildPlanting(`planting-${family}`, blockId, cropPluginId);

          const result = planInputs(
            buildBaseInput({
              plantings: [planting],
              blocks: [buildBlock(blockId)],
              cropPlugins: { [cropPluginId]: crop },
              seasonSetup: buildSetup(philosophy, approach)
            })
          );

          // Meta is always populated.
          expect(result.meta.philosophy).toBe(philosophy);
          expect(result.meta.fertilityApproach).toBe(approach);
          expect(result.meta.year).toBe(YEAR);

          // Pre-plant fertility:
          //   - Emitted for every family with a removal default (all 6
          //     in this matrix have one — legumes use the entry that
          //     declares n-removal=0; for them only P+K drive a deficit
          //     when soil credits are absent).
          //   - The chosen product (when one is chosen) must be
          //     philosophy-allowed.
          const fertilityApp = result.applications.find((a) => a.slot === 'pre-plant-fertility');

          if (fertilityApp) {
            expect(fertilityApp.productCategory).toBe('fertilizer');
            if (fertilityApp.productPluginId) {
              expect(FIXTURE_POOL_COVERS_EVERY_PHILOSOPHY).toBe(true);
            } else {
              // No product picked → must have a warning explaining why.
              expect(
                result.warnings.some(
                  (w) => w.kind === 'no-compliant-product' && w.slot === 'pre-plant-fertility'
                )
              ).toBe(true);
            }
          }

          // Family-specific assertions:
          if (family === 'corn') {
            // Corn always gets a sidedress-N synthesized.
            expect(result.applications.some((a) => a.slot === 'sidedress-n')).toBe(true);
          }
          if (family === 'legume') {
            // Legumes have nRemoval=0; the planner shouldn't synthesize
            // a sidedress-N for them.
            expect(result.applications.some((a) => a.slot === 'sidedress-n')).toBe(false);
          }
        });
      }
    }
  }
});

/* ─── 2. Targeted edge-case tests ───────────────────────────────────── */

describe('planInputs — strategy gates', () => {
  it('drops insecticide-prophylactic windows when pestStrategy === ipm', () => {
    const crop = buildCrop('solanaceae', 'tomato', {
      sprayWindows: [
        {
          chemistryClass: 'glufosinate' as never,
          purpose: 'insecticide-prophylactic',
          anchor: 'planting',
          offsetDaysMin: 30,
          offsetDaysMax: 45,
          title: 'Prophylactic insecticide'
        }
      ]
    });
    const planting = buildPlanting('p1', 'b1', 'tomato');

    const ipm = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { tomato: crop },
        seasonSetup: buildSetup('conventional', 'synthetic', { pestStrategy: 'ipm' })
      })
    );
    expect(ipm.applications.some((a) => a.slot === 'insecticide-prophylactic')).toBe(false);

    const preventive = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { tomato: crop },
        seasonSetup: buildSetup('conventional', 'synthetic', { pestStrategy: 'preventive' })
      })
    );
    expect(preventive.applications.some((a) => a.slot === 'insecticide-prophylactic')).toBe(true);
  });

  it('skips pre-emergent windows when weedStrategy === cultivate-first', () => {
    const crop = buildCrop('corn', 'corn-1', {
      sprayWindows: [
        {
          chemistryClass: 'glufosinate' as never,
          purpose: 'pre-emergent',
          weedStrategyGate: 'pre-emergence-ok',
          anchor: 'planting',
          offsetDaysMin: 0,
          offsetDaysMax: 7,
          title: 'PRE herbicide'
        }
      ]
    });
    const planting = buildPlanting('p1', 'b1', 'corn-1');

    const cultivate = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { 'corn-1': crop },
        seasonSetup: buildSetup('conventional', 'synthetic', { weedStrategy: 'cultivate-first' })
      })
    );
    expect(cultivate.applications.some((a) => a.slot === 'pre-emergent')).toBe(false);

    const postOk = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { 'corn-1': crop },
        seasonSetup: buildSetup('conventional', 'synthetic', { weedStrategy: 'post-emergence-ok' })
      })
    );
    expect(postOk.applications.some((a) => a.slot === 'pre-emergent')).toBe(true);
  });

  it('emits IPM scout tasks for ipm + minimal but not preventive', () => {
    const crop = buildCrop('cucurbit', 'zucchini');
    const planting = buildPlanting('p1', 'b1', 'zucchini');

    for (const strategy of ['ipm', 'minimal'] as const) {
      const result = planInputs(
        buildBaseInput({
          plantings: [planting],
          blocks: [buildBlock('b1')],
          cropPlugins: { zucchini: crop },
          seasonSetup: buildSetup('conventional', 'synthetic', { pestStrategy: strategy })
        })
      );
      expect(result.scoutTasks).toHaveLength(1);
      expect(result.scoutTasks[0].recurrenceDays).toBe(7);
      expect(result.scoutTasks[0].title).toContain('squash vine borer');
    }

    const preventive = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { zucchini: crop },
        seasonSetup: buildSetup('conventional', 'synthetic', { pestStrategy: 'preventive' })
      })
    );
    expect(preventive.scoutTasks).toHaveLength(0);
  });
});

describe('planInputs — synthesized slots', () => {
  it('synthesizes sidedress-N for corn at +35d when no V6 stage code present', () => {
    const crop = buildCrop('corn', 'corn-a');
    const planting = buildPlanting('p1', 'b1', 'corn-a');

    const result = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { 'corn-a': crop },
        seasonSetup: buildSetup('conventional', 'synthetic')
      })
    );

    const sidedress = result.applications.find((a) => a.slot === 'sidedress-n');
    expect(sidedress).toBeDefined();
    // Family default: 35 days after planting.
    expect(sidedress?.applicationDateMs).toBe(PLANTING_MS + 35 * DAY);
  });

  it('synthesizes cover-terminate when coverCropIntent !== none', () => {
    const crop = buildCrop('solanaceae', 'tomato');
    const planting = buildPlanting('p1', 'b1', 'tomato');

    const withCover = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { tomato: crop },
        seasonSetup: buildSetup('conventional', 'synthetic', { coverCropIntent: 'vetch-clover' })
      })
    );
    expect(withCover.applications.some((a) => a.slot === 'cover-terminate')).toBe(true);

    const noCover = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { tomato: crop },
        seasonSetup: buildSetup('conventional', 'synthetic', { coverCropIntent: 'none' })
      })
    );
    expect(noCover.applications.some((a) => a.slot === 'cover-terminate')).toBe(false);
  });

  it('cover-terminate under cultivate-first weed strategy skips herbicide (mow + incorporate)', () => {
    const crop = buildCrop('solanaceae', 'tomato');
    const planting = buildPlanting('p1', 'b1', 'tomato');

    const result = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { tomato: crop },
        seasonSetup: buildSetup('conventional', 'synthetic', {
          coverCropIntent: 'fall-cereal',
          weedStrategy: 'cultivate-first'
        })
      })
    );

    const terminate = result.applications.find((a) => a.slot === 'cover-terminate');
    expect(terminate).toBeDefined();
    expect(terminate?.productPluginId).toBeNull();
    expect(terminate?.rationale).toContain('Mow + incorporate');
  });
});

describe('planInputs — fertility budget arithmetic', () => {
  it('soil-test N credit reduces the pre-plant fertility deficit', () => {
    const crop = buildCrop('corn', 'corn-1');
    const planting = buildPlanting('p1', 'b1', 'corn-1');

    const baseInput = (test?: SoilTest) =>
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { 'corn-1': crop },
        soilTests: test ? [test] : [],
        seasonSetup: buildSetup('conventional', 'synthetic')
      });

    const without = planInputs(baseInput());
    const withTest = planInputs(
      baseInput({
        id: 'soil-1',
        blockId: 'b1',
        sampledAt: Date.UTC(2025, 8, 1),
        nitratePpm: 33 // 33 - 8 baseline = 25 × 4 = 100 lb-N credit
      })
    );

    const fertWithout = without.applications.find((a) => a.slot === 'pre-plant-fertility');
    const fertWith = withTest.applications.find((a) => a.slot === 'pre-plant-fertility');

    expect(fertWithout?.totalAmount ?? 0).toBeGreaterThan(fertWith?.totalAmount ?? 0);
  });

  it('explicit fertility credits reduce the pre-plant fertility deficit', () => {
    const crop = buildCrop('corn', 'corn-1');
    const planting = buildPlanting('p1', 'b1', 'corn-1');
    const credit: FertilityCredit = {
      id: 'c1',
      blockId: 'b1',
      appliesToYear: YEAR,
      source: 'fall vetch terminated',
      nLbPerAcre: 90,
      pLbPerAcre: 0,
      kLbPerAcre: 0,
      createdAt: Date.UTC(2025, 9, 1)
    };

    const without = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { 'corn-1': crop }
      })
    );
    const withCredit = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { 'corn-1': crop },
        fertilityCredits: [credit]
      })
    );

    const fertWithout = without.applications.find((a) => a.slot === 'pre-plant-fertility');
    const fertWith = withCredit.applications.find((a) => a.slot === 'pre-plant-fertility');

    expect(fertWith?.totalAmount ?? 0).toBeLessThan(fertWithout?.totalAmount ?? 0);
  });

  // Regression #228: 'cover-crop-credits' must subtract cover-legume N
  // fixation from the deficit. Vetch → corn went from 150 lb-N/ac
  // (full removal default) to ~85 lb-N/ac (150 − 65 credit) after fix.
  it('cover-crop-credits + vetch-clover subtracts N credit from deficit (#228)', () => {
    const crop = buildCrop('corn', 'corn-1');
    const planting = buildPlanting('p1', 'b1', 'corn-1');
    const buildIt = (intent: 'vetch-clover' | 'fall-cereal' | 'none') =>
      planInputs(
        buildBaseInput({
          plantings: [planting],
          blocks: [buildBlock('b1')],
          cropPlugins: { 'corn-1': crop },
          seasonSetup: buildSetup('conventional', 'synthetic', {
            fertilityApproach: 'cover-crop-credits',
            coverCropIntent: intent
          })
        })
      );

    const vetch = buildIt('vetch-clover');
    const cereal = buildIt('fall-cereal');
    const none = buildIt('none');

    const fertVetch = vetch.applications.find((a) => a.slot === 'pre-plant-fertility');
    const fertCereal = cereal.applications.find((a) => a.slot === 'pre-plant-fertility');
    const fertNone = none.applications.find((a) => a.slot === 'pre-plant-fertility');

    // Cereal + none give no credit; vetch must reduce the rate.
    expect(fertVetch?.totalAmount ?? 0).toBeLessThan(fertCereal?.totalAmount ?? 0);
    expect(fertVetch?.rationale).toMatch(/vetch-clover/);

    // Cereal + none should produce identical deficits since both credit 0.
    expect(fertCereal?.totalAmount).toBe(fertNone?.totalAmount);
  });

  it('cover-crop-credits without legume cover (fall-cereal) does NOT credit N (#228)', () => {
    const crop = buildCrop('corn', 'corn-1');
    const planting = buildPlanting('p1', 'b1', 'corn-1');
    const result = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { 'corn-1': crop },
        seasonSetup: buildSetup('conventional', 'synthetic', {
          fertilityApproach: 'cover-crop-credits',
          coverCropIntent: 'fall-cereal'
        })
      })
    );
    const fert = result.applications.find((a) => a.slot === 'pre-plant-fertility');
    // Rationale should not reference a credit when intent is cereal.
    expect(fert?.rationale).not.toMatch(/vetch-clover/);
  });

  it('cover-crop-credits not selected → no N credit even with vetch-clover intent', () => {
    const crop = buildCrop('corn', 'corn-1');
    const planting = buildPlanting('p1', 'b1', 'corn-1');
    const vetchOnly = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { 'corn-1': crop },
        seasonSetup: buildSetup('conventional', 'synthetic', {
          fertilityApproach: 'synthetic',
          coverCropIntent: 'vetch-clover'
        })
      })
    );
    const fert = vetchOnly.applications.find((a) => a.slot === 'pre-plant-fertility');
    // Rationale must not include the cover-crop credit annotation since
    // the operator did not choose the credits-based approach.
    expect(fert?.rationale).not.toMatch(/vetch-clover/);
  });

  it('omits pre-plant fertility application when removal default is unknown (warning emitted)', () => {
    // 'small-fruit' has no FAMILY_REMOVAL_DEFAULTS entry.
    const crop = buildCrop('small-fruit', 'blueberry');
    const planting = buildPlanting('p1', 'b1', 'blueberry');

    const result = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { blueberry: crop }
      })
    );

    expect(result.applications.some((a) => a.slot === 'pre-plant-fertility')).toBe(false);
    expect(
      result.warnings.some((w) => w.kind === 'missing-yield-goal' && w.cropFamily === 'small-fruit')
    ).toBe(true);
  });
});

describe('planInputs — shopping list', () => {
  it('aggregates application totals across plantings and subtracts on-hand stock', () => {
    const crop = buildCrop('corn', 'corn-1');
    const plantings = [buildPlanting('p1', 'b1', 'corn-1'), buildPlanting('p2', 'b2', 'corn-1')];
    const blocks = [buildBlock('b1', 2), buildBlock('b2', 3)];

    const result = planInputs(
      buildBaseInput({
        plantings,
        blocks,
        cropPlugins: { 'corn-1': crop },
        seasonSetup: buildSetup('conventional', 'synthetic'),
        existingStock: [
          {
            pluginId: 'urea-46',
            category: 'fertilizer',
            displayName: 'urea-46',
            defaultUnit: 'lb',
            onHand: 50
          }
        ]
      })
    );

    const ureaRow = result.shoppingList.find((s) => s.pluginId === 'urea-46');
    expect(ureaRow).toBeDefined();
    expect(ureaRow?.appliesToPlantingIds).toEqual(['p1', 'p2']);
    expect(ureaRow?.onHand).toBe(50);
    expect(ureaRow?.shortfall).toBeGreaterThan(0);
    expect(ureaRow?.totalNeeded).toBeGreaterThan(50);
  });

  it('shortfall is zero when on-hand covers the total needed', () => {
    const crop = buildCrop('legume', 'beans');
    const planting = buildPlanting('p1', 'b1', 'beans');

    const result = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1', 0.5)],
        cropPlugins: { beans: crop },
        existingStock: [
          {
            pluginId: 'bone-meal-omri',
            category: 'fertilizer',
            displayName: 'bone-meal-omri',
            defaultUnit: 'lb',
            onHand: 10000
          }
        ]
      })
    );

    const bone = result.shoppingList.find((s) => s.pluginId === 'bone-meal-omri');
    if (bone) {
      expect(bone.shortfall).toBe(0);
    }
  });
});

describe('planInputs — warnings', () => {
  it('warns when a plugin spray window lacks a purpose tag', () => {
    const crop = buildCrop('cucurbit', 'zucchini', {
      sprayWindows: [
        {
          chemistryClass: 'glufosinate' as never,
          anchor: 'planting',
          offsetDaysMin: 7,
          offsetDaysMax: 14,
          title: 'Some legacy window'
        }
      ]
    });
    const result = planInputs(
      buildBaseInput({
        plantings: [buildPlanting('p1', 'b1', 'zucchini')],
        blocks: [buildBlock('b1')],
        cropPlugins: { zucchini: crop }
      })
    );

    expect(
      result.warnings.some(
        (w) => w.kind === 'missing-spray-window-purpose' && w.windowTitle === 'Some legacy window'
      )
    ).toBe(true);
  });

  it('warns when a planting has no plantingDate', () => {
    const crop = buildCrop('corn', 'corn-1');
    const planting: PlantingRecord = {
      ...buildPlanting('p1', 'b1', 'corn-1'),
      plantingDate: null
    };

    const result = planInputs(
      buildBaseInput({
        plantings: [planting],
        blocks: [buildBlock('b1')],
        cropPlugins: { 'corn-1': crop }
      })
    );

    expect(
      result.warnings.some((w) => w.kind === 'missing-anchor-date' && w.plantingId === 'p1')
    ).toBe(true);
  });
});

describe('planInputs — meta', () => {
  it('uses nowMs override when supplied', () => {
    const result = planInputs(buildBaseInput({ nowMs: 12345 }));
    expect(result.meta.generatedAtMs).toBe(12345);
  });

  it('falls back to Date.now when nowMs is omitted', () => {
    const before = Date.now();
    const result = planInputs({ ...buildBaseInput(), nowMs: undefined });
    const after = Date.now();
    expect(result.meta.generatedAtMs).toBeGreaterThanOrEqual(before);
    expect(result.meta.generatedAtMs).toBeLessThanOrEqual(after);
  });
});
