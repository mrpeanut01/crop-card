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
