import { describe, expect, it } from 'vitest';
import {
  FIXTURE_ANIMAL_HEALTH,
  FIXTURE_PEST_MODEL,
  FIXTURE_SOURCE,
  FIXTURE_SPECIES
} from './dataKinds.fixtures';
import {
  animalHealthPluginSchema,
  cropPluginSchema,
  grazingRestrictionsSchema,
  herbicidePluginSchema,
  pestModelPluginSchema,
  speciesPluginSchema
} from './schemas';
import {
  animalHealthFactPaths,
  checkPastureCoverage,
  checkSources,
  cropFactPaths,
  grazingFactPaths,
  isPastureLabelled,
  missingWithdrawals,
  pestModelFactPaths,
  seasonalTaskWordingProblems,
  stageTemplateWordingProblems,
  speciesFactPaths,
  type SourceMap
} from './sourceCoverage';

const animalHealth = animalHealthPluginSchema.parse(FIXTURE_ANIMAL_HEALTH);
const pestModel = pestModelPluginSchema.parse(FIXTURE_PEST_MODEL);
const species = speciesPluginSchema.parse(FIXTURE_SPECIES);

function sourced(pluginId: string, paths: string[]): SourceMap {
  return { [pluginId]: Object.fromEntries(paths.map((p) => [p, FIXTURE_SOURCE])) };
}

describe('fact paths', () => {
  it('lists every animal-health withdrawal value', () => {
    expect(animalHealthFactPaths(animalHealth)).toEqual([
      'withdrawal.test-fixture-species-hen.laying.meatDays',
      'withdrawal.test-fixture-species-hen.laying.eggsDays',
      'withdrawal.test-fixture-species-hen.non-laying.meatDays',
      'withdrawal.test-fixture-species-hen.non-laying.doNotUseFor'
    ]);
  });

  it('asks for a source for an organicUse (33B, B-03)', () => {
    const withUse = animalHealthPluginSchema.parse({
      ...FIXTURE_ANIMAL_HEALTH,
      organicUse: { status: 'allowed-with-conditions', citation: '205.603(a)(1)' }
    });
    expect(animalHealthFactPaths(withUse)).toContain('organicUse');
    expect(checkSources([{ pluginId: withUse.pluginId, paths: ['organicUse'] }], {})).toEqual([
      { pluginId: withUse.pluginId, path: 'organicUse', problem: 'missing' }
    ]);
    expect(
      animalHealthPluginSchema.safeParse({
        ...FIXTURE_ANIMAL_HEALTH,
        organicUse: { status: 'fine', citation: '205.603' }
      }).success
    ).toBe(false);
  });

  it('lists every pest-model number', () => {
    expect(pestModelFactPaths(pestModel)).toEqual([
      'baseTempF',
      'upperCutoffF',
      'stages.adults.gddFrom',
      'stages.adults.gddTo',
      'stages.eggs.gddFrom'
    ]);
  });

  it('lists the species food flag and care intervals', () => {
    expect(speciesFactPaths(species)).toEqual([
      'foodProducingDefault',
      'careDefaults.check.intervalDays'
    ]);
  });

  it('lists each coop or pen space figure a species carries', () => {
    const withSpace = speciesPluginSchema.parse({
      ...FIXTURE_SPECIES,
      housingSpace: { indoorSqFtPerAnimal: 4, sourceName: 'Test Extension' }
    });
    expect(speciesFactPaths(withSpace)).toContain('housingSpace.indoorSqFtPerAnimal');
    expect(speciesFactPaths(withSpace)).not.toContain('housingSpace.outdoorSqFtPerAnimal');
    expect(() =>
      speciesPluginSchema.parse({ ...FIXTURE_SPECIES, housingSpace: { sourceName: 'Nothing' } })
    ).toThrow();
  });

  it('lists grazing numbers and true safety flags only', () => {
    const g = grazingRestrictionsSchema.parse({
      grazeDays: 7,
      notForPasture: false,
      manureCarryover: true,
      speciesExceptions: [{ speciesId: 'goat', lactating: true, hayDays: 3 }],
      source: 'Test label'
    });
    expect(grazingFactPaths(g)).toEqual([
      'grazeDays',
      'manureCarryover',
      'speciesExceptions.goat.lactating.hayDays'
    ]);
  });

  it('lists the Phase 33C carryover days and a true hay flag (M-17)', () => {
    const g = grazingRestrictionsSchema.parse({
      grazeDays: 0,
      manureCarryover: true,
      manureCarryoverDays: 3,
      hayOffFarmRestricted: true,
      source: 'Test label'
    });
    expect(grazingFactPaths(g)).toEqual([
      'grazeDays',
      'manureCarryoverDays',
      'manureCarryover',
      'hayOffFarmRestricted'
    ]);
    const off = grazingRestrictionsSchema.parse({
      manureCarryover: true,
      hayOffFarmRestricted: false,
      source: 'Test label'
    });
    expect(grazingFactPaths(off)).toEqual(['manureCarryover']);
  });

  it('refuses carryover days on a product not flagged as carrying over (M-18)', () => {
    expect(
      grazingRestrictionsSchema.safeParse({ manureCarryoverDays: 3, source: 'Test label' }).success
    ).toBe(false);
    expect(
      grazingRestrictionsSchema.safeParse({
        manureCarryover: false,
        manureCarryoverDays: 3,
        source: 'Test label'
      }).success
    ).toBe(false);
    expect(
      grazingRestrictionsSchema.safeParse({
        manureCarryover: true,
        manureCarryoverDays: -1,
        source: 'Test label'
      }).success
    ).toBe(false);
  });

  it('lists the new crop numbers and each toxic species, and nothing for empty fields', () => {
    const base = {
      pluginId: 'crop-test',
      type: 'crop',
      displayName: 'Test Crop',
      version: '1',
      cropFamily: 'solanaceae',
      harvestStyle: 'continuous-fruit',
      bloomWindow: { daysFromPlantingMin: 1, daysFromPlantingMax: 2, beeAttractive: false }
    };
    expect(cropFactPaths(cropPluginSchema.parse(base))).toEqual([]);
    const crop = cropPluginSchema.parse({
      ...base,
      plantingGuide: { establishment: 'transplant', startIndoorsWeeks: { min: 6, max: 8 } },
      animalToxicity: [{ speciesIds: ['dog', 'cat'], parts: ['leaves'], severity: 'toxic' }]
    });
    expect(cropFactPaths(crop)).toEqual([
      'startIndoorsWeeks',
      'animalToxicity.dog',
      'animalToxicity.cat'
    ]);
  });

  it('asks for a source for every seeding rate value', () => {
    const base = {
      pluginId: 'crop-test',
      type: 'crop',
      displayName: 'Test Crop',
      version: '1',
      cropFamily: 'solanaceae',
      harvestStyle: 'continuous-fruit',
      bloomWindow: { daysFromPlantingMin: 1, daysFromPlantingMax: 2, beeAttractive: false }
    };
    const crop = cropPluginSchema.parse({
      ...base,
      plantingGuide: {
        seedingRate: {
          drilledLbsPerAcre: { min: 60, max: 120 },
          broadcastLbsPerAcre: { min: 90, max: 160 },
          drillRowSpacingIn: { min: 6, max: 8 }
        }
      }
    });
    expect(cropFactPaths(crop)).toEqual([
      'seedingRate.drilledLbsPerAcre',
      'seedingRate.broadcastLbsPerAcre',
      'seedingRate.drillRowSpacingIn'
    ]);
    expect(() =>
      cropPluginSchema.parse({
        ...base,
        plantingGuide: { seedingRate: { drilledLbsPerAcre: { min: 1, max: 2 }, rateGuess: 3 } }
      })
    ).toThrow();
  });
});

describe('checkSources', () => {
  const paths = animalHealthFactPaths(animalHealth);
  const item = [{ pluginId: animalHealth.pluginId, paths }];

  it('fails a fixture plugin missing a source', () => {
    const partial = sourced(animalHealth.pluginId, paths.slice(1));
    expect(checkSources(item, partial)).toEqual([
      { pluginId: animalHealth.pluginId, path: paths[0], problem: 'missing' }
    ]);
  });

  it('passes when every value is sourced', () => {
    expect(checkSources(item, sourced(animalHealth.pluginId, paths))).toEqual([]);
  });

  it('flags a source entry without a quote or with a plain-http url', () => {
    const sources = sourced(animalHealth.pluginId, paths);
    sources[animalHealth.pluginId][paths[0]] = { ...FIXTURE_SOURCE, quote: '' };
    sources[animalHealth.pluginId][paths[1]] = { ...FIXTURE_SOURCE, url: 'http://example.org' };
    expect(checkSources(item, sources).map((g) => g.problem)).toEqual(['invalid', 'invalid']);
  });
});

describe('missingWithdrawals', () => {
  const noWithdrawal = animalHealthPluginSchema.parse({
    ...FIXTURE_ANIMAL_HEALTH,
    labelUses: [
      { speciesId: 'test-food' },
      { speciesId: 'test-pet' },
      { speciesId: 'test-unknown' },
      { speciesId: 'test-sourced', withdrawal: { meatDays: 1 } }
    ]
  });
  const isFood = (id: string) =>
    id === 'test-food' || id === 'test-sourced' ? true : id === 'test-pet' ? false : undefined;

  it('flags food and unknown species with no withdrawal, never a pet', () => {
    expect(missingWithdrawals(noWithdrawal, isFood)).toEqual([
      'withdrawal.test-food.all',
      'withdrawal.test-unknown.all'
    ]);
  });
});

describe('pasture coverage', () => {
  const herbicide = (extra: Record<string, unknown>) =>
    herbicidePluginSchema.parse({
      pluginId: 'test-herb',
      type: 'herbicide',
      displayName: 'Test Herbicide',
      version: '1',
      activeIngredients: [{ name: 'test', chemistryClass: 'synthetic-auxin' }],
      ratePerAcre: { amount: 1, unit: 'qt' },
      ...extra
    });
  const familyOf = (id: string) => (id === 'test-alfalfa' ? 'forage' : 'corn');

  it('detects pasture labels from text or forage claims', () => {
    expect(isPastureLabelled(herbicide({}), familyOf)).toBe(false);
    expect(isPastureLabelled(herbicide({ notes: 'For pasture and hay.' }), familyOf)).toBe(true);
    expect(
      isPastureLabelled(herbicide({ notes: 'Standard tool for alfalfa and soybean.' }), familyOf)
    ).toBe(true);
    expect(
      isPastureLabelled(herbicide({ notes: 'Labeled for lettuce, peanut, clover.' }), familyOf)
    ).toBe(true);
    expect(isPastureLabelled(herbicide({ notes: 'For hay fields.' }), familyOf)).toBe(true);
    expect(isPastureLabelled(herbicide({ notes: 'Corn and soybean only.' }), familyOf)).toBe(false);
    expect(
      isPastureLabelled(
        herbicide({ labelClaims: { safeForCropPluginIds: ['test-alfalfa'] } }),
        familyOf
      )
    ).toBe(true);
    expect(
      isPastureLabelled(
        herbicide({ labelClaims: { safeForCropPluginIds: ['test-corn'] } }),
        familyOf
      )
    ).toBe(false);
  });

  it('fails an uncovered pasture product and passes the allowlist path', () => {
    const plugins = [herbicide({ notes: 'Rangeland use.' })];
    expect(checkPastureCoverage(plugins, familyOf, []).unallowlisted).toEqual(['test-herb']);
    expect(
      checkPastureCoverage(plugins, familyOf, [{ pluginId: 'test-herb', reason: 'Test reason.' }])
    ).toEqual({ unallowlisted: [], stale: [] });
  });

  it('passes a covered product and flags its allowlist entry as stale', () => {
    const plugins = [
      herbicide({
        notes: 'Rangeland use.',
        grazingRestrictions: { grazeDays: 0, source: 'Test label' }
      })
    ];
    expect(
      checkPastureCoverage(plugins, familyOf, [{ pluginId: 'test-herb', reason: 'Test reason.' }])
    ).toEqual({ unallowlisted: [], stale: ['test-herb'] });
  });
});

describe('seasonalTaskWordingProblems (OC-1)', () => {
  const crop = (rows: Record<string, unknown>[], field = 'seasonalTasks') =>
    ({ pluginId: 'test-crop', [field]: rows }) as unknown as Parameters<
      typeof seasonalTaskWordingProblems
    >[0][number];

  it('passes the kept orchard and berry rows', () => {
    expect(
      seasonalTaskWordingProblems([
        crop([
          {
            key: 'winter-prune',
            kind: 'pruning',
            title: 'Winter pruning (dormant)',
            body: 'Remove 1/6 oldest canes.',
            category: 'prune'
          },
          {
            key: 'swd-monitoring',
            kind: 'scout',
            title: 'SWD trap monitoring',
            body: 'Spotted-wing drosophila is the dominant ripe-fruit pest.',
            category: 'scout'
          },
          {
            key: 'leaf-pull',
            kind: 'cultural',
            title: 'Pull basal leaves around clusters',
            body: 'Reduces botrytis.',
            category: 'other'
          },
          {
            key: 'mow',
            kind: 'pruning',
            title: 'Mow canes',
            body: 'Cut canes after dormancy; check soil moisture.',
            category: 'till'
          }
        ]),
        crop(
          [
            {
              key: 'post-bloom-thinning',
              title: 'Hand fruit thinning',
              body: 'Thin to one fruit per cluster.',
              category: 'prune'
            }
          ],
          'orchardSeasonalTasks'
        )
      ])
    ).toEqual([]);
  });

  it('fails a row of kind or category spray', () => {
    expect(
      seasonalTaskWordingProblems([
        crop([{ key: 'a', kind: 'spray', title: 'Look at leaves' }]),
        crop([{ key: 'b', title: 'Look at leaves', category: 'spray' }], 'orchardSeasonalTasks')
      ])
    ).toEqual([
      'test-crop seasonalTasks.a: kind spray',
      'test-crop orchardSeasonalTasks.b: category spray'
    ]);
  });

  it.each([
    ['Pre-bloom fungicide', 'fungicide'],
    ['Dormant oil window', 'oil'],
    ['Captan per label', 'Captan'],
    ['Streptomycin/Apogee gate', 'Streptomycin'],
    ['Apogee growth regulator', 'Apogee'],
    ['M03 mancozeb 3 lb/A', 'mancozeb'],
    ['Chlorothalonil cover', 'Chlorothalonil'],
    ['FRAC 3 (myclobutanil)', 'myclobutanil'],
    ['Alternate FRAC groups', 'FRAC'],
    ['Rotate IRAC groups', 'IRAC'],
    ['Respect 3-day PHI', 'PHI'],
    ['Wait out the REI', 'REI'],
    ['Captan + insecticide tank-mix', 'Captan'],
    ['Tank mix before bloom', 'Tank mix'],
    ['Pyrethroids on 5-7 d intervals', 'Pyrethroids'],
    ['Copper for fire blight', 'Copper'],
    ['Sulfur for mildew', 'Sulfur'],
    ['Bactericide at bloom', 'Bactericide'],
    ['Summer cover sprays', 'sprays'],
    ['Improves spray penetration', 'spray']
  ])('fails pesticide wording: %s', (body, word) => {
    expect(
      seasonalTaskWordingProblems([crop([{ key: 'x', kind: 'scout', title: 'Check', body }])])
    ).toEqual([`test-crop seasonalTasks.x: body says "${word}"`]);
  });

  it('does not read acronyms out of ordinary words', () => {
    expect(
      seasonalTaskWordingProblems([
        crop([
          {
            key: 'x',
            kind: 'scout',
            title: 'Graphite rein check',
            body: 'Phi and rei in lower case; soil and boil.'
          }
        ])
      ])
    ).toEqual([]);
  });
});

describe('stageTemplateWordingProblems (OC-1)', () => {
  it('flags product and spray wording in a stage hint', () => {
    expect(
      stageTemplateWordingProblems({
        'vine-fruit': {
          stages: [
            { code: 'bloom', inspect: 'Pre-bloom mancozeb / copper for black rot.' },
            { code: 'harvest', inspect: 'Respect the PHI.' },
            { code: 'veraison', inspect: 'Color change begins.' },
            { code: 'dormant' }
          ]
        },
        corn: null
      })
    ).toEqual([
      'vine-fruit bloom: inspect says "mancozeb"',
      'vine-fruit harvest: inspect says "PHI"'
    ]);
  });

  it('keeps the bloom caution against insecticides but nothing else beside it', () => {
    expect(
      stageTemplateWordingProblems({
        orchard: {
          stages: [{ code: 'bloom', inspect: 'Pollinator activity critical; AVOID insecticides.' }]
        }
      })
    ).toEqual([]);
    expect(
      stageTemplateWordingProblems({
        orchard: { stages: [{ code: 'bloom', inspect: 'Avoid insecticides; use a fungicide.' }] }
      })
    ).toEqual(['orchard bloom: inspect says "fungicide"']);
  });
});
