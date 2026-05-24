/**
 * Phase 25c.0 — discriminator field additions (#87).
 *
 * Verifies the new `harvestStyle` + `bloomWindow` fields accept the shapes
 * the 25c renderers + 25d pollinator-bloom evaluator will consume, and
 * that existing plugins still validate (back-compat — both fields are
 * optional until the corpus reaches ≥95% coverage and the Zod schema is
 * promoted to required).
 */

import { describe, expect, it } from 'vitest';
import {
  cropPluginSchema,
  bloomWindowSchema,
  HARVEST_STYLES,
  harvestStyleSchema
} from './schemas';

describe('Phase 25c.0 — harvestStyle', () => {
  it('accepts every declared HARVEST_STYLES value', () => {
    for (const style of HARVEST_STYLES) {
      expect(harvestStyleSchema.safeParse(style).success).toBe(true);
    }
  });

  it('rejects unknown harvest styles', () => {
    expect(harvestStyleSchema.safeParse('cucumber-blossom-pinch').success).toBe(false);
  });

  it('attaches to cropPluginSchema as optional (v1.0 plugin still validates)', () => {
    const v10 = {
      pluginId: 'corn-bloody-butcher',
      type: 'crop' as const,
      displayName: 'Bloody Butcher Dent Corn',
      version: '1.0.0',
      cropFamily: 'corn' as const
    };
    expect(cropPluginSchema.safeParse(v10).success).toBe(true);
  });

  it('attaches to cropPluginSchema with harvestStyle set', () => {
    const tagged = {
      pluginId: 'apple-fuji',
      type: 'crop' as const,
      displayName: 'Apple Fuji',
      version: '1.0.0',
      cropFamily: 'orchard' as const,
      harvestStyle: 'tree-fruit-multi-pick' as const
    };
    const parsed = cropPluginSchema.safeParse(tagged);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.harvestStyle).toBe('tree-fruit-multi-pick');
    }
  });
});

describe('Phase 25c.0 — bloomWindow', () => {
  it('accepts an annual day-from-planting window', () => {
    const cucurbit = {
      daysFromPlantingMin: 35,
      daysFromPlantingMax: 60,
      beeAttractive: true
    };
    expect(bloomWindowSchema.safeParse(cucurbit).success).toBe(true);
  });

  it('accepts a perennial monthsOfYear window', () => {
    const apple = { monthsOfYear: [4, 5], beeAttractive: true };
    expect(bloomWindowSchema.safeParse(apple).success).toBe(true);
  });

  it('accepts a continuous bloomer', () => {
    const tomato = { continuous: true, beeAttractive: true };
    expect(bloomWindowSchema.safeParse(tomato).success).toBe(true);
  });

  it('rejects empty bloomWindow (must declare at least one timing shape)', () => {
    expect(bloomWindowSchema.safeParse({}).success).toBe(false);
    expect(bloomWindowSchema.safeParse({ beeAttractive: true }).success).toBe(false);
    expect(bloomWindowSchema.safeParse({ notes: 'tba' }).success).toBe(false);
  });

  it('rejects monthsOfYear with out-of-range values', () => {
    expect(bloomWindowSchema.safeParse({ monthsOfYear: [0] }).success).toBe(false);
    expect(bloomWindowSchema.safeParse({ monthsOfYear: [13] }).success).toBe(false);
  });

  it('rejects daysFromPlantingMin > daysFromPlantingMax', () => {
    const inverted = { daysFromPlantingMin: 60, daysFromPlantingMax: 30 };
    expect(bloomWindowSchema.safeParse(inverted).success).toBe(false);
  });

  it('accepts only daysFromPlantingMin (no max)', () => {
    expect(bloomWindowSchema.safeParse({ daysFromPlantingMin: 35 }).success).toBe(true);
  });

  it('attaches to cropPluginSchema with both new fields', () => {
    const fullyTagged = {
      pluginId: 'tomato-cherokee-purple',
      type: 'crop' as const,
      displayName: 'Tomato — Cherokee Purple',
      version: '1.0.0',
      cropFamily: 'solanaceae' as const,
      harvestStyle: 'continuous-fruit' as const,
      bloomWindow: { continuous: true, beeAttractive: true }
    };
    const parsed = cropPluginSchema.safeParse(fullyTagged);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.bloomWindow?.continuous).toBe(true);
      expect(parsed.data.harvestStyle).toBe('continuous-fruit');
    }
  });
});

describe('Phase 25c.0 — back-compat sanity', () => {
  it('a typical existing crop plugin (no 25c.0 fields) still validates', () => {
    const existing = {
      pluginId: 'acorn-squash-table-queen',
      type: 'crop' as const,
      displayName: 'Acorn Squash — Table Queen',
      version: '1.0.0',
      cropFamily: 'cucurbit' as const,
      daysToMaturity: { min: 80, max: 90 },
      defaultRowSpacingInches: 60,
      harvestIndicators: ['Dark green rind with tiny orange spot'],
      plantingGuide: { vineSpreadFt: { min: 6, max: 10 } },
      agronomy: { lifecycle: 'annual' as const, rotationLookbackYears: 2 }
    };
    expect(cropPluginSchema.safeParse(existing).success).toBe(true);
  });
});
