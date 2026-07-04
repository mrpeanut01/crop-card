import { describe, expect, it } from 'vitest';
import { checkCrossContamination, checkCrossContaminationForClasses } from './crossContamination';
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

describe('checkCrossContaminationForClasses (#321 — insecticide / fungicide loads)', () => {
  it('passes a fresh sprayer with no history for an insecticide load', () => {
    expect(checkCrossContaminationForClasses(['insecticide-load'], { id: 's1' })).toEqual({
      violations: [],
      requiresDecon: false
    });
  });

  it('demands decon for a herbicide after an insecticide load (the #321 bug)', () => {
    // Prior insecticide pass recorded `insecticide-load`; a herbicide now
    // planned differs → the gate must fire (previously it never ran).
    const sprayer: SprayerState = {
      id: 's1',
      lastChemistryClass: 'insecticide-load',
      lastSprayedAt: 1000
    };
    const out = checkCrossContaminationForClasses(['glyphosate'], sprayer);
    expect(out.requiresDecon).toBe(true);
    expect(out.violations[0].code).toBe('CROSS_CONTAMINATION');
  });

  it('demands decon for an insecticide after a herbicide load', () => {
    const sprayer: SprayerState = {
      id: 's1',
      lastChemistryClass: 'synthetic-auxin',
      lastSprayedAt: 1000
    };
    const out = checkCrossContaminationForClasses(['insecticide-load'], sprayer);
    expect(out.requiresDecon).toBe(true);
    expect(out.violations[0].code).toBe('CROSS_CONTAMINATION');
  });

  it('demands decon for a herbicide after a fungicide load', () => {
    const sprayer: SprayerState = {
      id: 's1',
      lastChemistryClass: 'fungicide-load',
      lastSprayedAt: 1000
    };
    expect(checkCrossContaminationForClasses(['synthetic-auxin'], sprayer).requiresDecon).toBe(
      true
    );
  });

  it('passes an insecticide load repeated back-to-back', () => {
    const sprayer: SprayerState = {
      id: 's1',
      lastChemistryClass: 'insecticide-load',
      lastSprayedAt: 1000
    };
    expect(checkCrossContaminationForClasses(['insecticide-load'], sprayer)).toEqual({
      violations: [],
      requiresDecon: false
    });
  });

  it('clears an insecticide-after-herbicide once decon is recorded', () => {
    const sprayer: SprayerState = {
      id: 's1',
      lastChemistryClass: 'synthetic-auxin',
      lastSprayedAt: 1000,
      lastDeconAt: 2000
    };
    expect(checkCrossContaminationForClasses(['insecticide-load'], sprayer).requiresDecon).toBe(
      false
    );
  });
});
