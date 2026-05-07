import { describe, expect, it } from 'vitest';
import type { HerbicidePlugin } from '$lib/plugins/schemas';
import { computeDilution, computeTankMixDilutions } from './calculator';

const auxin: HerbicidePlugin = {
  pluginId: '24d',
  type: 'herbicide',
  displayName: '2,4-D Amine',
  version: '1.0.0',
  activeIngredients: [{ name: '2,4-D', chemistryClass: 'synthetic-auxin' }],
  ratePerAcre: { amount: 1, unit: 'pt' },
  gpaCalibration: 15
};

const stadia: HerbicidePlugin = {
  pluginId: 'stadia',
  type: 'herbicide',
  displayName: 'Stadia (dry)',
  version: '1.0.0',
  activeIngredients: [{ name: 'stadia-ai', chemistryClass: 'sulfonylurea' }],
  ratePerAcre: { amount: 1.5, unit: 'oz' },
  gpaCalibration: 15
};

describe('computeDilution', () => {
  it('1pt/A on a 15gal tank @ 15 GPA gives 1pt total (1 acre)', () => {
    const out = computeDilution({ herbicide: auxin, tankSizeGallons: 15 });
    expect(out.acresCovered).toBeCloseTo(1, 5);
    expect(out.productAmount).toBeCloseTo(1, 5);
    expect(out.unit).toBe('pt');
    expect(out.gpaUsed).toBe(15);
  });

  it('scales linearly with tank size at constant GPA', () => {
    const small = computeDilution({ herbicide: auxin, tankSizeGallons: 25 });
    const big = computeDilution({ herbicide: auxin, tankSizeGallons: 100 });
    expect(big.productAmount / small.productAmount).toBeCloseTo(4, 5);
    expect(big.acresCovered / small.acresCovered).toBeCloseTo(4, 5);
  });

  it('rescales when calibratedGpa differs from plugin gpaCalibration', () => {
    const standard = computeDilution({ herbicide: auxin, tankSizeGallons: 50 });
    const overcalibrated = computeDilution({
      herbicide: auxin,
      tankSizeGallons: 50,
      calibratedGpa: 20
    });
    // At higher GPA the same tank covers fewer acres; product needed drops.
    expect(overcalibrated.acresCovered).toBeLessThan(standard.acresCovered);
    expect(overcalibrated.productAmount).toBeLessThan(standard.productAmount);
    expect(overcalibrated.gpaUsed).toBe(20);
  });

  it('respects customRatePerAcre and flags the record', () => {
    const out = computeDilution({
      herbicide: auxin,
      tankSizeGallons: 25,
      customRatePerAcre: { amount: 0.5, unit: 'pt' }
    });
    const standard = computeDilution({ herbicide: auxin, tankSizeGallons: 25 });
    expect(out.customRateApplied).toBe(true);
    expect(out.productAmount).toBeCloseTo(standard.productAmount * 0.5, 5);
  });

  it('handles solid units (oz) without unit conversion', () => {
    const out = computeDilution({ herbicide: stadia, tankSizeGallons: 50 });
    // 50gal / 15 GPA = 3.33 acres; 1.5 oz/A * 3.33 = 5 oz
    expect(out.unit).toBe('oz');
    expect(out.productAmount).toBeCloseTo(5, 1);
  });

  it('rejects nonsensical tank or GPA values', () => {
    expect(() => computeDilution({ herbicide: auxin, tankSizeGallons: 0 })).toThrow();
    expect(() =>
      computeDilution({ herbicide: auxin, tankSizeGallons: 25, calibratedGpa: 0 })
    ).toThrow();
  });
});

describe('computeTankMixDilutions', () => {
  it('returns one line per product, all sized to the same tank', () => {
    const lines = computeTankMixDilutions([auxin, stadia], 50);
    expect(lines).toHaveLength(2);
    expect(lines[0].pluginId).toBe('24d');
    expect(lines[1].pluginId).toBe('stadia');
    expect(new Set(lines.map((l) => l.acresCovered)).size).toBe(1);
  });
});
