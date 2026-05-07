import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { checkChemistryCompatibility, isIncompatiblePair } from './chemistry';
import { CHEMISTRY_CLASSES, type ChemistryClass, type HerbicideProduct } from './types';

function product(id: string, classes: ChemistryClass[]): HerbicideProduct {
  return {
    pluginId: id,
    displayName: id,
    activeIngredients: classes.map((c, i) => ({ name: `ai-${i}`, chemistryClass: c }))
  };
}

describe('isIncompatiblePair', () => {
  it('flags synthetic-auxin × chloroacetamide', () => {
    expect(isIncompatiblePair('synthetic-auxin', 'chloroacetamide')).toBe(true);
  });

  it('returns false for identical class', () => {
    for (const cls of CHEMISTRY_CLASSES) {
      expect(isIncompatiblePair(cls, cls)).toBe(false);
    }
  });

  it('is symmetric for every class pair', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CHEMISTRY_CLASSES),
        fc.constantFrom(...CHEMISTRY_CLASSES),
        (a, b) => isIncompatiblePair(a, b) === isIncompatiblePair(b, a)
      )
    );
  });
});

describe('checkChemistryCompatibility', () => {
  it('returns no violations for a single product', () => {
    const out = checkChemistryCompatibility([product('p1', ['glyphosate'])]);
    expect(out).toHaveLength(0);
  });

  it('flags an incompatible tank mix', () => {
    const out = checkChemistryCompatibility([
      product('24d', ['synthetic-auxin']),
      product('dual', ['chloroacetamide'])
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('CHEMISTRY_INCOMPATIBLE');
  });

  it('does not double-count ingredients within one product', () => {
    const out = checkChemistryCompatibility([
      product('combo', ['synthetic-auxin', 'chloroacetamide'])
    ]);
    expect(out).toHaveLength(0);
  });

  it('emits one violation per incompatible cross-product pair', () => {
    const out = checkChemistryCompatibility([
      product('a', ['accase-inhibitor']),
      product('b', ['sulfonylurea']),
      product('c', ['glyphosate'])
    ]);
    expect(out.map((v) => v.code)).toEqual(['CHEMISTRY_INCOMPATIBLE', 'CHEMISTRY_INCOMPATIBLE']);
  });
});

describe('Phase 9 — new chemistry pair incompatibilities', () => {
  it('flags glufosinate × glyphosate antagonism', () => {
    expect(isIncompatiblePair('glufosinate', 'glyphosate')).toBe(true);
  });

  it('flags glufosinate × synthetic-auxin label-prohibited mix', () => {
    expect(isIncompatiblePair('glufosinate', 'synthetic-auxin')).toBe(true);
  });

  it('flags clomazone × glyphosate formulation incompatibility', () => {
    expect(isIncompatiblePair('clomazone', 'glyphosate')).toBe(true);
  });

  it('flags ppo-inhibitor × als-imidazolinone crop-injury risk', () => {
    expect(isIncompatiblePair('ppo-inhibitor', 'als-imidazolinone')).toBe(true);
  });

  it('flags accase × atrazine antagonism', () => {
    expect(isIncompatiblePair('accase-inhibitor', 'photosystem-ii-triazine')).toBe(true);
  });

  it('flags accase × glufosinate antagonism', () => {
    expect(isIncompatiblePair('accase-inhibitor', 'glufosinate')).toBe(true);
  });

  it('does not falsely flag compatible newer pairs', () => {
    expect(isIncompatiblePair('microtubule-inhibitor', 'glyphosate')).toBe(false);
    expect(isIncompatiblePair('vlcfa-pyroxasulfone', 'photosystem-ii-triazine')).toBe(false);
  });
});
