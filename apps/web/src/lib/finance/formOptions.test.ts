// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { plantingOptions } from './formOptions.server';
import { categoriesFor, categoryLabel, isCategoryFor } from './categories';
import type { FarmNames } from './profit.server';

function names(): FarmNames {
  return {
    plantingPlugin: { a: 'carrot-x', b: 'carrot-x', c: 'carrot-x' },
    plantingLabel: { a: 'Nantes', b: 'Nantes', c: 'Nantes' },
    plantingBlock: { a: 'bed1', b: 'bed2', c: 'bed1' },
    plantingDate: {
      a: Date.UTC(2027, 2, 3),
      b: Date.UTC(2027, 2, 3),
      c: null
    },
    crop: { 'carrot-x': 'Carrot' },
    group: {},
    animal: {},
    area: {},
    bed: { bed1: 'Bed 1', bed2: 'Bed 2' },
    blockField: new Map()
  };
}

describe('finance planting options (#734)', () => {
  it('names the bed and planting date so repeats read apart', () => {
    const labels = plantingOptions(names()).map((o) => o.label);
    expect(new Set(labels).size).toBe(3);
    expect(labels).toContain('Carrot, Nantes · Bed 1 · planted Mar 3, 2027');
    expect(labels).toContain('Carrot, Nantes · Bed 2 · planted Mar 3, 2027');
    expect(labels).toContain('Carrot, Nantes · Bed 1 · not planted yet');
  });

  it('reads in Spanish', () => {
    const labels = plantingOptions(names(), 'es').map((o) => o.label);
    expect(labels.some((l) => l.includes('sin fecha de siembra'))).toBe(true);
    expect(labels.some((l) => l.includes('sembrado el'))).toBe(true);
  });

  it('keeps the old label when the names carry no bed or date', () => {
    const n = names();
    delete n.plantingBlock;
    delete n.plantingDate;
    expect(plantingOptions(n)[0].label).toBe('Carrot, Nantes');
  });
});

describe('CSA share income category (#734)', () => {
  it('is an income category with English and Spanish labels', () => {
    expect(categoriesFor('income')).toContain('csa-share');
    expect(isCategoryFor('expense', 'csa-share')).toBe(false);
    expect(categoryLabel('csa-share')).toBe('CSA shares');
    expect(categoryLabel('csa-share', 'es')).toBe('Cuotas de CSA');
  });
});
