/**
 * TEST FIXTURES ONLY. Schema-valid examples of the Phase 32 plugin kinds.
 * Every number here is made up to exercise validation and is not label,
 * veterinary or extension data. Never copy these into plugins/.
 */

export const FIXTURE_SPECIES = {
  pluginId: 'test-fixture-species-hen',
  displayName: 'Test fixture hen',
  version: '0.0.0-test',
  type: 'species',
  groupNoun: 'flock',
  foodProducingDefault: true,
  products: ['eggs', 'meat'],
  tile: { icon: 'egg', label: 'Hens' },
  careDefaults: [
    { key: 'check', kind: 'health-check', title: 'Test fixture check', intervalDays: 7 },
    { key: 'vet', kind: 'vaccination', title: 'Test fixture vaccine', note: 'Ask your vet.' }
  ],
  notes: 'Test fixture, not real species data.'
};

export const FIXTURE_PET_SPECIES = {
  pluginId: 'test-fixture-species-pet',
  displayName: 'Test fixture pet',
  version: '0.0.0-test',
  type: 'species',
  groupNoun: 'litter',
  foodProducingDefault: false,
  products: ['companion'],
  tile: { icon: 'dog' }
};

export const FIXTURE_ANIMAL_HEALTH = {
  pluginId: 'test-fixture-dewormer',
  displayName: 'Test fixture dewormer',
  version: '0.0.0-test',
  type: 'animal-health',
  productKind: 'dewormer',
  activeIngredients: [{ name: 'test-fixture-ingredient' }],
  marketingStatus: 'otc',
  labelUses: [
    {
      speciesId: 'test-fixture-species-hen',
      class: 'laying',
      routes: ['drinking-water'],
      withdrawal: { meatDays: 3, eggsDays: 1 }
    },
    {
      speciesId: 'test-fixture-species-hen',
      class: 'non-laying',
      withdrawal: { meatDays: 3, doNotUseFor: ['eggs'] }
    }
  ],
  notes: 'Test fixture, not label data.'
};

export const FIXTURE_PEST_MODEL = {
  pluginId: 'test-fixture-borer',
  displayName: 'Test fixture borer model',
  version: '0.0.0-test',
  type: 'pest-model',
  pest: { commonName: 'Test fixture borer' },
  hostCropFamilies: ['cucurbit'],
  method: 'single-sine',
  baseTempF: 50,
  upperCutoffF: 90,
  biofix: { kind: 'january-1' },
  stages: [
    {
      key: 'adults',
      label: 'Adults flying',
      gddFrom: 900,
      gddTo: 1000,
      action: 'cover',
      message: 'Cover young vines with row cover.'
    },
    {
      key: 'eggs',
      label: 'Eggs on stems',
      gddFrom: 1000,
      action: 'scout',
      message: 'Check stem bases for eggs.'
    }
  ],
  notes: 'Test fixture, not extension data.'
};

export const FIXTURE_SOURCE = {
  url: 'https://example.org/test-fixture-label.pdf',
  publisher: 'Test fixture publisher',
  date: '2026-01-01',
  quote: 'Test fixture quote, not a real label statement.'
};
