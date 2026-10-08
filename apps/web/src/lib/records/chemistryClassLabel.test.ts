import { describe, expect, it } from 'vitest';
import { CHEMISTRY_CLASSES, SPRAYER_LOAD_CLASSES } from '$lib/safety/types';
import { chemistryClassLabel } from './chemistryClassLabel';

describe('chemistryClassLabel (#631)', () => {
  it('names herbicide classes with their HRAC group', () => {
    expect(chemistryClassLabel('synthetic-auxin')).toBe('Synthetic auxin (HRAC 4)');
    expect(chemistryClassLabel('chloroacetamide')).toBe('Chloroacetamide (HRAC 15)');
    expect(chemistryClassLabel('synthetic-auxin', 'es')).toBe('Auxina sintética (HRAC 4)');
  });

  it('never shows a raw code for any kernel class', () => {
    for (const c of CHEMISTRY_CLASSES) {
      const label = chemistryClassLabel(c);
      expect(label).not.toBe(c);
      expect(label).not.toMatch(/-/);
    }
  });

  it('passes IRAC/FRAC labels and unknown text through', () => {
    expect(chemistryClassLabel('IRAC 3A')).toBe('IRAC 3A');
    expect(chemistryClassLabel('Group 9')).toBe('Group 9');
  });

  it('names insecticide and fungicide sprayer loads without the code (#619)', () => {
    expect(chemistryClassLabel('fungicide-load')).toBe('fungicide');
    expect(chemistryClassLabel('insecticide-load')).toBe('insecticide');
    expect(chemistryClassLabel('fungicide-load', 'es')).toBe('fungicida');
    for (const c of SPRAYER_LOAD_CLASSES) expect(chemistryClassLabel(c)).not.toMatch(/load/);
  });
});
