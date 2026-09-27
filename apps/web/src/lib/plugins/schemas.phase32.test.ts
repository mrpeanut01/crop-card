import { describe, expect, it } from 'vitest';
import {
  cropPluginSchema,
  fungicidePluginSchema,
  grazingRestrictionsSchema,
  herbicidePluginSchema,
  insecticidePluginSchema,
  pluginSchema
} from './schemas';

// Test values only; none of these numbers come from a label.
const HERBICIDE = {
  pluginId: 'herb-test',
  type: 'herbicide' as const,
  displayName: 'Test Herbicide',
  version: '1',
  activeIngredients: [{ name: 'glyphosate', chemistryClass: 'glyphosate' as const }],
  ratePerAcre: { amount: 1, unit: 'qt' as const }
};
const INSECTICIDE = {
  pluginId: 'ins-test',
  type: 'insecticide' as const,
  displayName: 'Test Insecticide',
  version: '1',
  activeIngredients: [{ name: 'spinosad', iracGroup: '5' }],
  reEntryIntervalHours: 4
};
const FUNGICIDE = {
  pluginId: 'fun-test',
  type: 'fungicide' as const,
  displayName: 'Test Fungicide',
  version: '1',
  activeIngredients: [{ name: 'copper hydroxide', fracCode: 'M01' }],
  ratePerAcre: { amount: 1, unit: 'lb' as const },
  reEntryIntervalHours: 12,
  preHarvestIntervalDays: 0
};
const CROP = {
  pluginId: 'crop-test',
  type: 'crop' as const,
  displayName: 'Test Crop',
  version: '1',
  cropFamily: 'solanaceae' as const,
  harvestStyle: 'continuous-fruit' as const,
  bloomWindow: { daysFromPlantingMin: 60, daysFromPlantingMax: 90, beeAttractive: true } as const
};
const GRAZING = {
  grazeDays: 7,
  hayDays: 30,
  lactatingDairyGrazeDays: 14,
  meatAnimalRemovalBeforeSlaughterDays: 3,
  speciesExceptions: [
    { speciesId: 'goat', grazeDays: 10 },
    { speciesId: 'goat', lactating: true, grazeDays: 20 }
  ],
  notForPasture: false,
  manureCarryover: true,
  source: 'Test label, EPA 000-000, 2026'
};

describe('grazingRestrictions', () => {
  it.each([
    ['herbicide', herbicidePluginSchema, HERBICIDE],
    ['insecticide', insecticidePluginSchema, INSECTICIDE],
    ['fungicide', fungicidePluginSchema, FUNGICIDE]
  ] as const)('is optional and accepted on %s plugins', (_kind, schema, base) => {
    expect(schema.safeParse(base).success).toBe(true);
    const parsed = schema.parse({ ...base, grazingRestrictions: GRAZING });
    expect(parsed.grazingRestrictions?.hayDays).toBe(30);
  });

  it('survives the library union', () => {
    const parsed = pluginSchema.parse({ ...HERBICIDE, grazingRestrictions: GRAZING });
    expect(parsed.type === 'herbicide' && parsed.grazingRestrictions?.grazeDays).toBe(7);
  });

  it('requires a source', () => {
    const { source: _drop, ...rest } = GRAZING;
    expect(grazingRestrictionsSchema.safeParse(rest).success).toBe(false);
  });

  it('refuses unknown keys, negatives and fractions', () => {
    for (const bad of [
      { ...GRAZING, overrideKernel: true },
      { ...GRAZING, grazeDays: -1 },
      { ...GRAZING, hayDays: 2.5 }
    ]) {
      expect(grazingRestrictionsSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('refuses a duplicate or empty species exception', () => {
    const dup = { speciesId: 'goat', grazeDays: 1 };
    expect(
      grazingRestrictionsSchema.safeParse({ ...GRAZING, speciesExceptions: [dup, dup] }).success
    ).toBe(false);
    expect(
      grazingRestrictionsSchema.safeParse({
        ...GRAZING,
        speciesExceptions: [{ speciesId: 'goat' }]
      }).success
    ).toBe(false);
  });
});

describe('crop plantingGuide seed-start fields', () => {
  it('accepts the new fields', () => {
    const parsed = cropPluginSchema.parse({
      ...CROP,
      plantingGuide: {
        establishment: 'transplant',
        startIndoorsWeeks: { min: 6, max: 8 },
        transplantOffsetDays: 14,
        hardenOffDays: { min: 7, max: 10 },
        germinationTempF: { min: 70, max: 85 },
        dtmFrom: 'transplant'
      }
    });
    expect(parsed.plantingGuide?.dtmFrom).toBe('transplant');
    expect(parsed.plantingGuide?.transplantOffsetDays).toBe(14);
  });

  it('keeps existing crops valid without them', () => {
    expect(cropPluginSchema.safeParse(CROP).success).toBe(true);
  });

  it('refuses bad values', () => {
    for (const plantingGuide of [
      { establishment: 'seedling' },
      { dtmFrom: 'either' },
      { startIndoorsWeeks: { min: 8, max: 6 } },
      { transplantOffsetDays: 1.5 },
      { transplantOffsetDays: 200 },
      { germinationTempF: { min: -5, max: 60 } }
    ]) {
      expect(cropPluginSchema.safeParse({ ...CROP, plantingGuide }).success).toBe(false);
    }
  });
});

describe('crop animalToxicity', () => {
  it('accepts entries', () => {
    const parsed = cropPluginSchema.parse({
      ...CROP,
      animalToxicity: [
        { speciesIds: ['dog', 'cat'], parts: ['leaves', 'stems'], severity: 'toxic' },
        { speciesIds: ['goat'], parts: ['unripe-fruit'], severity: 'caution', note: 'Test.' }
      ]
    });
    expect(parsed.animalToxicity).toHaveLength(2);
  });

  it('refuses a species listed twice, unknown keys and empty lists', () => {
    for (const animalToxicity of [
      [
        { speciesIds: ['dog'], parts: ['leaves'], severity: 'toxic' },
        { speciesIds: ['dog'], parts: ['fruit'], severity: 'caution' }
      ],
      [{ speciesIds: ['dog'], parts: ['leaves'], severity: 'toxic', lethalDose: 1 }],
      [{ speciesIds: [], parts: ['leaves'], severity: 'toxic' }],
      [{ speciesIds: ['dog'], parts: [], severity: 'toxic' }],
      [{ speciesIds: ['dog'], parts: ['leaves'], severity: 'deadly' }]
    ]) {
      expect(cropPluginSchema.safeParse({ ...CROP, animalToxicity }).success).toBe(false);
    }
  });
});
