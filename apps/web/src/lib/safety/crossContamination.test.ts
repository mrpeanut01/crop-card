import { describe, expect, it } from 'vitest';
import { checkCrossContamination } from './crossContamination';
import type { HerbicideProduct, SprayerState } from './types';

const auxin: HerbicideProduct = {
  pluginId: '24d',
  displayName: '2,4-D',
  activeIngredients: [{ name: '2,4-D', chemistryClass: 'synthetic-auxin' }]
};
const glypho: HerbicideProduct = {
  pluginId: 'gly',
  displayName: 'glyphosate',
  activeIngredients: [{ name: 'glyphosate', chemistryClass: 'glyphosate' }]
};

describe('checkCrossContamination', () => {
  it('passes a fresh sprayer with no history', () => {
    const sprayer: SprayerState = { id: 's1' };
    expect(checkCrossContamination([auxin], sprayer)).toEqual({
      violations: [],
      requiresDecon: false
    });
  });

  it('passes when planned chemistry matches last load', () => {
    const sprayer: SprayerState = {
      id: 's1',
      lastChemistryClass: 'synthetic-auxin',
      lastSprayedAt: 1000
    };
    const out = checkCrossContamination([auxin], sprayer);
    expect(out.requiresDecon).toBe(false);
    expect(out.violations).toEqual([]);
  });

  it('demands decon when chemistry differs and no decon recorded', () => {
    const sprayer: SprayerState = {
      id: 's1',
      lastChemistryClass: 'synthetic-auxin',
      lastSprayedAt: 1000
    };
    const out = checkCrossContamination([glypho], sprayer);
    expect(out.requiresDecon).toBe(true);
    expect(out.violations[0].code).toBe('CROSS_CONTAMINATION');
  });

  it('clears once decon is recorded after last spray', () => {
    const sprayer: SprayerState = {
      id: 's1',
      lastChemistryClass: 'synthetic-auxin',
      lastSprayedAt: 1000,
      lastDeconAt: 2000
    };
    expect(checkCrossContamination([glypho], sprayer)).toEqual({
      violations: [],
      requiresDecon: false
    });
  });

  it('does not clear when decon is older than last spray', () => {
    const sprayer: SprayerState = {
      id: 's1',
      lastChemistryClass: 'synthetic-auxin',
      lastSprayedAt: 5000,
      lastDeconAt: 3000
    };
    expect(checkCrossContamination([glypho], sprayer).requiresDecon).toBe(true);
  });
});
