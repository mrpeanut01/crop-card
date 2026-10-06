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
  seedingRateSchema,
  SEEDING_RATE_KEYS,
  SEEDING_RATE_QUALIFIER_KEYS,
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
  numbersIn,
  seasonalTaskNumberGaps,
  seasonalTaskWordingProblems,
  stageTemplateWordingProblems,
  speciesFactPaths,
  seedingRateQuoteGaps,
  rowSpacingGaps,
  treeSizeClassQuoteGaps,
  type SourceMap
} from './sourceCoverage';

const animalHealth = animalHealthPluginSchema.parse(FIXTURE_ANIMAL_HEALTH);
const pestModel = pestModelPluginSchema.parse(FIXTURE_PEST_MODEL);
const species = speciesPluginSchema.parse(FIXTURE_SPECIES);

const SEEDING_BASE = {
  pluginId: 'test-crop',
  type: 'crop',
  displayName: 'Test Crop',
  version: '1',
  cropFamily: 'solanaceae',
  harvestStyle: 'continuous-fruit',
  bloomWindow: { daysFromPlantingMin: 1, daysFromPlantingMax: 2, beeAttractive: false }
};

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

  it('gates the seed basis as its own sourced fact and refuses other bases', () => {
    const crop = cropPluginSchema.parse({
      ...SEEDING_BASE,
      plantingGuide: { seedingRate: { drilledLbsPerAcre: { min: 3, max: 5 }, seedBasis: 'pls' } }
    });
    expect(cropFactPaths(crop)).toEqual(['seedingRate.drilledLbsPerAcre', 'seedingRate.seedBasis']);
    expect(seedingRateSchema.safeParse({ seedBasis: 'certified' }).success).toBe(false);
  });

  it('keeps SEEDING_RATE_KEYS in step with the schema', () => {
    expect([...SEEDING_RATE_KEYS, ...SEEDING_RATE_QUALIFIER_KEYS].sort()).toEqual(
      Object.keys(seedingRateSchema.shape).sort()
    );
  });

  it('needs each seeding rate quote to state its range and basis', () => {
    const crop = cropPluginSchema.parse({
      ...SEEDING_BASE,
      plantingGuide: {
        seedingRate: {
          drilledLbsPerAcre: { min: 60, max: 120 },
          broadcastLbsPerAcre: { min: 90, max: 160 },
          seedsPerAcre: { min: 25000, max: 33000 },
          drillRowSpacingIn: { min: 6, max: 7 },
          seedBasis: 'bulk'
        }
      }
    });
    const quoted = (quote: string) => ({ ...FIXTURE_SOURCE, quote });
    const ok: SourceMap = {
      'test-crop': {
        'seedingRate.drilledLbsPerAcre': quoted('Drill 60 to 120 lb./A into a prepared seedbed'),
        'seedingRate.broadcastLbsPerAcre': quoted('row "Rye | 3/4–2 | 60–120 | 90–160 |"'),
        'seedingRate.seedsPerAcre': quoted('plant 25,000 to 33,000 kernels per acre'),
        'seedingRate.drillRowSpacingIn': quoted('While 6- to 7-inch row spacings are best'),
        'seedingRate.seedBasis': quoted('assuming legal standards for germination percentage')
      }
    };
    expect(seedingRateQuoteGaps([crop], ok)).toEqual([]);
    const bad: SourceMap = {
      'test-crop': {
        'seedingRate.drilledLbsPerAcre': quoted('Drill 160 to 1200 lb./A'),
        'seedingRate.broadcastLbsPerAcre': quoted('broadcast 90 to 150 lb./A'),
        'seedingRate.seedsPerAcre': quoted('plant 25,000 kernels per acre'),
        'seedingRate.drillRowSpacingIn': quoted('in 6 to 8 inch rows'),
        'seedingRate.seedBasis': quoted('Drill at 45 lbs./acre PLS')
      }
    };
    expect(seedingRateQuoteGaps([crop], bad)).toEqual([
      'test-crop: seedingRate.drilledLbsPerAcre quote does not state 60-120',
      'test-crop: seedingRate.broadcastLbsPerAcre quote does not state 90-160',
      'test-crop: seedingRate.seedsPerAcre quote does not state 25000-33000',
      'test-crop: seedingRate.drillRowSpacingIn quote does not state 6-7',
      'test-crop: seedingRate.seedBasis quote does not say bulk'
    ]);
  });

  it('#576: gates purpose, the droughty-soil cut and sownBy as sourced facts', () => {
    const crop = cropPluginSchema.parse({
      ...SEEDING_BASE,
      plantingGuide: {
        seedingRate: {
          drilledLbsPerAcre: { min: 30, max: 50 },
          seedsPerAcre: { min: 25000, max: 33000 },
          purpose: 'green-manure',
          droughtySoilCutPct: { min: 10, max: 15 }
        }
      }
    });
    expect(cropFactPaths(crop)).toEqual([
      'seedingRate.drilledLbsPerAcre',
      'seedingRate.seedsPerAcre',
      'seedingRate.purpose',
      'seedingRate.droughtySoilCutPct'
    ]);
    const quoted = (quote: string, url = FIXTURE_SOURCE.url) => ({ ...FIXTURE_SOURCE, url, quote });
    const vce =
      'On soils with high production potential where good production practices are followed, plant 25,000 to 33,000 kernels per acre. If planted on droughty soils, the rate of planting should be decreased by 10%-15%.';
    const ok: SourceMap = {
      'test-crop': {
        'seedingRate.drilledLbsPerAcre': quoted('Drilled: 30-50 lbs. pure live seed per acre'),
        'seedingRate.seedsPerAcre': quoted(vce),
        'seedingRate.purpose': quoted('Green manure crop used to add nitrogen'),
        'seedingRate.droughtySoilCutPct': quoted(vce)
      }
    };
    expect(seedingRateQuoteGaps([crop], ok)).toEqual([]);
    const bad: SourceMap = {
      'test-crop': {
        'seedingRate.drilledLbsPerAcre': quoted('Drilled: 30-50 lbs. pure live seed per acre'),
        'seedingRate.seedsPerAcre': quoted(vce),
        'seedingRate.purpose': quoted('A green manure crop', 'https://example.org/other'),
        'seedingRate.droughtySoilCutPct': quoted('decrease by 10%-20% on droughty soils')
      }
    };
    expect(seedingRateQuoteGaps([crop], bad)).toEqual([
      "test-crop: seedingRate.purpose is not from a rate's own source",
      'test-crop: seedingRate.droughtySoilCutPct quote does not state 10-15% on droughty soils against a high-potential rate'
    ]);
    expect(
      seedingRateQuoteGaps([crop], {
        'test-crop': { ...ok['test-crop'], 'seedingRate.purpose': quoted('forage rates') }
      })
    ).toEqual(['test-crop: seedingRate.purpose quote does not say green-manure']);
    expect(seedingRateSchema.safeParse({ purpose: 'general-cover' }).success).toBe(false);
  });

  it('#576: a sownBy method needs a quote naming it, and a seedingRate needs content', () => {
    const crop = cropPluginSchema.parse({
      ...SEEDING_BASE,
      plantingGuide: { seedingRate: { sownBy: ['drilled', 'broadcast'] } }
    });
    expect(cropFactPaths(crop)).toEqual([
      'seedingRate.sownBy.drilled',
      'seedingRate.sownBy.broadcast'
    ]);
    const quoted = (quote: string) => ({ ...FIXTURE_SOURCE, quote });
    expect(
      seedingRateQuoteGaps([crop], {
        'test-crop': {
          'seedingRate.sownBy.drilled': quoted('If drilling oats, seed at 2 to 3 bushels'),
          'seedingRate.sownBy.broadcast': quoted('Broadcasting or overseeding will give')
        }
      })
    ).toEqual([]);
    expect(
      seedingRateQuoteGaps([crop], {
        'test-crop': {
          'seedingRate.sownBy.drilled': quoted('Seed at 2 to 3 bushels'),
          'seedingRate.sownBy.broadcast': quoted('Broadcasting or overseeding will give')
        }
      })
    ).toEqual(['test-crop: seedingRate.sownBy.drilled quote does not name drilled']);
    const empty = cropPluginSchema.parse({ ...SEEDING_BASE, plantingGuide: { seedingRate: {} } });
    expect(seedingRateQuoteGaps([empty], {})).toEqual([
      'test-crop: seedingRate has no rate, row width or sownBy'
    ]);
    const purposeOnly = cropPluginSchema.parse({
      ...SEEDING_BASE,
      plantingGuide: { seedingRate: { sownBy: ['drilled'], purpose: 'smother' } }
    });
    expect(seedingRateQuoteGaps([purposeOnly], {})).toEqual([
      'test-crop: seedingRate.purpose has no rate'
    ]);
    expect(seedingRateSchema.safeParse({ sownBy: [] }).success).toBe(false);
    expect(seedingRateSchema.safeParse({ sownBy: ['drilled', 'drilled'] }).success).toBe(false);
  });

  it('reads a row width written as "7-inch to 8-inch"', () => {
    const crop = cropPluginSchema.parse({
      ...SEEDING_BASE,
      plantingGuide: { seedingRate: { drillRowSpacingIn: { min: 7, max: 8 } } }
    });
    const src = (quote: string): SourceMap => ({
      'test-crop': { 'seedingRate.drillRowSpacingIn': { ...FIXTURE_SOURCE, quote } }
    });
    expect(
      seedingRateQuoteGaps([crop], src('a drill that plants in 7-inch to 8-inch rows'))
    ).toEqual([]);
    expect(
      seedingRateQuoteGaps([crop], src('a drill that plants in 17-inch to 8-inch rows'))
    ).toEqual(['test-crop: seedingRate.drillRowSpacingIn quote does not state 7-8']);
  });
});

describe('tree size classes', () => {
  const crop = cropPluginSchema.parse({
    pluginId: 'apple-test',
    type: 'crop',
    displayName: 'Apple Test',
    version: '1',
    cropFamily: 'orchard',
    harvestStyle: 'tree-fruit-multi-pick',
    bloomWindow: { monthsOfYear: [4], beeAttractive: true },
    treeSizeClasses: [
      { sizeClass: 'dwarf', minSpacingFt: 8, yearsToBearing: { min: 2, max: 3 } },
      { sizeClass: 'standard', minSpacingFt: 30, yearsToBearing: { min: 6, max: 10 } }
    ]
  });

  it('lists one source path per size class', () => {
    expect(cropFactPaths(crop)).toEqual(['treeSizeClasses.dwarf', 'treeSizeClasses.standard']);
  });

  it('refuses two rows for one size class', () => {
    const rows = [
      { sizeClass: 'dwarf', minSpacingFt: 8, yearsToBearing: { min: 2, max: 3 } },
      { sizeClass: 'dwarf', minSpacingFt: 10, yearsToBearing: { min: 2, max: 3 } }
    ];
    expect(cropPluginSchema.safeParse({ ...crop, treeSizeClasses: rows }).success).toBe(false);
  });

  it('needs the quote to state both the spacing and the bearing age', () => {
    const sources: SourceMap = {
      'apple-test': {
        'treeSizeClasses.dwarf': {
          ...FIXTURE_SOURCE,
          quote: 'row "Apple - dwarf | 8 | 2 | 2–3 | 30-35 |"'
        },
        'treeSizeClasses.standard': {
          ...FIXTURE_SOURCE,
          quote: 'row "Apple - standard | 18 | 8 | 6-8 |"'
        }
      }
    };
    expect(treeSizeClassQuoteGaps([crop], sources)).toEqual([
      'apple-test: treeSizeClasses.standard quote does not state 30 ft',
      'apple-test: treeSizeClasses.standard quote does not state 6-10 years'
    ]);
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
        crop([
          {
            key: 'post-bloom-thinning',
            title: 'Hand fruit thinning',
            body: 'Thin to one fruit per cluster.',
            category: 'prune'
          }
        ])
      ])
    ).toEqual([]);
  });

  it('fails a row of kind or category spray', () => {
    expect(
      seasonalTaskWordingProblems([
        crop([{ key: 'a', kind: 'spray', title: 'Look at leaves' }]),
        crop([{ key: 'b', title: 'Look at leaves', category: 'spray' }])
      ])
    ).toEqual([
      'test-crop seasonalTasks.a: kind spray',
      'test-crop seasonalTasks.b: category spray'
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

  it('refuses "label" but keeps row cover and frost protection (OP-21)', () => {
    expect(
      seasonalTaskWordingProblems([
        crop([
          {
            key: 'a',
            kind: 'scout',
            title: 'Bloom frost watch',
            body: 'Row cover for protection.'
          },
          { key: 'b', kind: 'cultural', title: 'Mulch', body: 'Follow the label.' },
          { key: 'c', kind: 'cultural', title: 'Labels on trays', body: 'Mark each tray.' }
        ])
      ])
    ).toEqual([
      'test-crop seasonalTasks.b: body says "label"',
      'test-crop seasonalTasks.c: title says "Labels"'
    ]);
  });
});

describe('seasonalTaskNumberGaps (OP-21)', () => {
  const crop = (rows: Record<string, unknown>[], field = 'seasonalTasks') =>
    ({ pluginId: 'test-crop', [field]: rows }) as unknown as Parameters<
      typeof seasonalTaskNumberGaps
    >[0][number];
  const entry = (quote: string) => ({
    url: 'https://extension.example.edu/page',
    publisher: 'Example Extension',
    date: '2024-01-01',
    quote
  });

  it('reads every number a row writes', () => {
    expect(numbersIn('Pick every 2–3 d. Cool to 32–34 °F within 1 h; remove 1/6; 1.5 in')).toEqual([
      '2',
      '3',
      '32',
      '34',
      '1',
      '1',
      '6',
      '1.5'
    ]);
  });

  it('passes rows with no numbers and rows whose quote states every number', () => {
    const sources = {
      'test-crop': {
        'seasonalTasks.mulch': entry('Apply 3 to 4 inches of straw after the soil freezes.'),
        'seasonalTasks.harvest': entry('Check fruit 1,000 times, every 7 days.')
      }
    };
    expect(
      seasonalTaskNumberGaps(
        [
          crop([
            { key: 'scout', title: 'Scout', body: 'Look for beetles.' },
            { key: 'mulch', title: 'Mulch 3–4 in', body: 'Straw after the soil freezes.' }
          ]),
          crop([{ key: 'harvest', title: 'Pick', body: 'Every 7 d; 1000 checks.' }])
        ],
        sources
      )
    ).toEqual([]);
  });

  it('fails a number with no source, or a quote that does not state it', () => {
    const sources = {
      'test-crop': {
        'seasonalTasks.frost': entry('Open blossoms are killed at 30°F or lower.'),
        'seasonalTasks.bad': { url: 'http://x.example.com', quote: 'short' }
      }
    };
    expect(
      seasonalTaskNumberGaps(
        [
          crop([
            { key: 'frost', title: 'Frost watch', body: 'Blossoms freeze at 28 °F; 300 h.' },
            { key: 'none', title: 'Tip at 4 ft' },
            { key: 'bad', title: 'Thin at 6 in' }
          ])
        ],
        sources
      )
    ).toEqual([
      'test-crop seasonalTasks.frost: quote does not state 28',
      'test-crop seasonalTasks.frost: quote does not state 300',
      'test-crop seasonalTasks.none: no source for 4',
      'test-crop seasonalTasks.bad: no source for 6'
    ]);
  });

  it('does not count a number inside a longer one', () => {
    const sources = {
      'test-crop': { 'seasonalTasks.a': entry('Remove 16 canes and 0.5 of the 30.') }
    };
    expect(
      seasonalTaskNumberGaps(
        [crop([{ key: 'a', title: 'Remove 6 canes', body: '5 or 3' }])],
        sources
      )
    ).toEqual([
      'test-crop seasonalTasks.a: quote does not state 6',
      'test-crop seasonalTasks.a: quote does not state 5',
      'test-crop seasonalTasks.a: quote does not state 3'
    ]);
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

  it('refuses any number in a stage hint (OP-21)', () => {
    expect(
      stageTemplateWordingProblems({
        'vine-fruit': {
          stages: [
            { code: 'dormant', inspect: 'Cane pruning window (Concord = 4-arm Kniffin).' },
            { code: 'harvest', inspect: 'Characteristic foxy aroma (Concord).' }
          ]
        }
      })
    ).toEqual(['vine-fruit dormant: inspect has a number']);
  });
});

describe('#587 / #591 row spacing', () => {
  const base = cropPluginSchema.parse({
    pluginId: 'cherry-test',
    type: 'crop',
    displayName: 'Cherry Test',
    version: '1',
    cropFamily: 'stone-fruit',
    harvestStyle: 'tree-fruit-multi-pick',
    archetype: 'tree-fruit-multi-pick',
    bloomWindow: { monthsOfYear: [4], beeAttractive: true },
    defaultRowSpacingInches: 300,
    plantingGuide: { rowSpacingIn: 216 }
  });

  it('needs a source for a tree crop row spacing', () => {
    expect(cropFactPaths(base)).toEqual(['rowSpacingIn', 'defaultRowSpacingInches']);
    expect(checkSources([{ pluginId: base.pluginId, paths: cropFactPaths(base) }], {})).toEqual([
      { pluginId: 'cherry-test', path: 'rowSpacingIn', problem: 'missing' },
      { pluginId: 'cherry-test', path: 'defaultRowSpacingInches', problem: 'missing' }
    ]);
  });

  it('#591: gates a non-tree crop row spacing too', () => {
    const veg = { ...base, archetype: 'continuous-harvest-fruit' as const };
    expect(cropFactPaths(veg)).toEqual(['rowSpacingIn', 'defaultRowSpacingInches']);
    const sources: SourceMap = {
      'cherry-test': {
        rowSpacingIn: { ...FIXTURE_SOURCE, quote: 'Distance between rows | 24-36 in' },
        defaultRowSpacingInches: { ...FIXTURE_SOURCE, quote: 'rows 25 feet apart' }
      }
    };
    expect(rowSpacingGaps([veg], sources)).toEqual([
      'cherry-test: rowSpacingIn quote does not state 216 in'
    ]);
  });

  it('#591: accepts feet written as a word', () => {
    const veg = cropPluginSchema.parse({
      ...base,
      archetype: 'continuous-harvest-fruit',
      defaultRowSpacingInches: undefined,
      plantingGuide: { rowSpacingIn: 24 }
    });
    const quote = (q: string): SourceMap => ({
      'cherry-test': { rowSpacingIn: { ...FIXTURE_SOURCE, quote: q } }
    });
    expect(
      rowSpacingGaps([veg], quote('one foot between plants, two feet between the rows'))
    ).toEqual([]);
    expect(rowSpacingGaps([veg], quote('three feet between the rows'))).toEqual([
      'cherry-test: rowSpacingIn quote does not state 24 in'
    ]);
  });

  it('#591: one rowSpacingIn source covers an equal defaultRowSpacingInches', () => {
    const veg = cropPluginSchema.parse({
      ...base,
      archetype: 'continuous-harvest-fruit',
      defaultRowSpacingInches: 30,
      plantingGuide: { rowSpacingIn: 30 }
    });
    expect(cropFactPaths(veg)).toEqual(['rowSpacingIn']);
    const sources: SourceMap = {
      'cherry-test': {
        rowSpacingIn: { ...FIXTURE_SOURCE, quote: 'Distance between rows | 30-36 in' }
      }
    };
    expect(rowSpacingGaps([veg], sources)).toEqual([]);
    const unequal = { ...veg, defaultRowSpacingInches: 36 };
    expect(cropFactPaths(unequal)).toEqual(['rowSpacingIn', 'defaultRowSpacingInches']);
  });

  it("#591: a tree crop's in-row spacing quote states both ends", () => {
    const tree = cropPluginSchema.parse({
      ...base,
      defaultRowSpacingInches: undefined,
      plantingGuide: { inRowSpacingIn: { min: 120, max: 180 } }
    });
    expect(cropFactPaths(tree)).toEqual(['inRowSpacingIn']);
    const sources: SourceMap = {
      'cherry-test': {
        inRowSpacingIn: {
          ...FIXTURE_SOURCE,
          quote: 'Minimum Spacing Between Trees (feet): Figs | 10'
        }
      }
    };
    expect(rowSpacingGaps([tree], sources)).toEqual([
      'cherry-test: inRowSpacingIn quote does not state 180 in'
    ]);
  });

  it('needs the quote to state the number in inches or feet', () => {
    const sources: SourceMap = {
      'cherry-test': {
        rowSpacingIn: { ...FIXTURE_SOURCE, quote: 'rows 18 feet apart' },
        defaultRowSpacingInches: { ...FIXTURE_SOURCE, quote: 'Suggested Spacing (ft) 25 x 30' }
      }
    };
    expect(rowSpacingGaps([base], sources)).toEqual([
      'cherry-test: defaultRowSpacingInches quote does not say the figure is between rows'
    ]);
  });

  it('refuses any row spacing on a crop with a size class table', () => {
    const tree = {
      ...base,
      treeSizeClasses: [
        { sizeClass: 'dwarf' as const, minSpacingFt: 8, yearsToBearing: { min: 2, max: 3 } }
      ]
    };
    expect(rowSpacingGaps([tree], {})).toEqual([
      'cherry-test: rowSpacingIn is never read when treeSizeClasses spaces the crop',
      'cherry-test: defaultRowSpacingInches is never read when treeSizeClasses spaces the crop'
    ]);
  });
});
