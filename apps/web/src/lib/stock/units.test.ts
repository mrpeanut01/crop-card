import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS } from '$lib/prefs';
import {
  convert,
  formatRateText,
  formatStockQuantity,
  perAcreRateUnit,
  fromHundredths,
  isLabelUnitCategory,
  isSeedCountUnit,
  SEED_UNITS,
  stockUnitLabel,
  toHundredths,
  toStorage
} from './units';

describe('convert', () => {
  it('converts within liquid units', () => {
    expect(convert(1, 'gal', 'fl-oz')).toBe(128);
    expect(convert(1, 'qt', 'pt')).toBe(2);
    expect(convert(8, 'fl-oz', 'pt')).toBe(0.5);
  });

  it('converts within solid units', () => {
    expect(convert(1, 'lb', 'oz')).toBeCloseTo(16, 2);
    expect(convert(1, 'kg', 'g')).toBe(1000);
    expect(convert(1, 'lb', 'kg')).toBeCloseTo(0.453592, 4);
  });

  it('returns null for incompatible units', () => {
    expect(convert(1, 'gal', 'lb')).toBeNull();
    expect(convert(1, 'fl-oz', 'count')).toBeNull();
    expect(convert(1, 'count', 'lb')).toBeNull();
  });

  it('identity for same unit', () => {
    expect(convert(42, 'count', 'count')).toBe(42);
    expect(convert(3.5, 'pt', 'pt')).toBe(3.5);
  });
});

describe('hundredths round-trip', () => {
  it('preserves 2 decimal places', () => {
    expect(fromHundredths(toHundredths(1.5))).toBe(1.5);
    expect(fromHundredths(toHundredths(0.33))).toBe(0.33);
  });
});

describe('toStorage', () => {
  it('converts + scales to default-unit hundredths', () => {
    // 1 pt of a fl-oz-tracked SKU = 1600 hundredths-of-fl-oz
    expect(toStorage(1, 'pt', 'fl-oz')).toBe(1600);
    // 0.5 qt of a fl-oz-tracked SKU = 1600 hundredths
    expect(toStorage(0.5, 'qt', 'fl-oz')).toBe(1600);
  });

  it('returns null when conversion is impossible', () => {
    expect(toStorage(1, 'lb', 'gal')).toBeNull();
  });
});

describe('formatStockQuantity', () => {
  it('shows the stored unit for US users', () => {
    expect(formatStockQuantity(12, 'gal')).toBe('12.0 gal');
    expect(formatStockQuantity(50, 'lb', { units: 'us' }, { digits: 0 })).toBe('50 lb');
  });
  it('converts plain weights and volumes for metric users', () => {
    expect(formatStockQuantity(12, 'gal', { units: 'metric' })).toBe('45.4 L');
    expect(formatStockQuantity(8, 'fl-oz', { units: 'metric' })).toBe('237 mL');
    expect(formatStockQuantity(50, 'lb', { units: 'metric' })).toBe('22.7 kg');
    expect(formatStockQuantity(4, 'oz', { units: 'metric' })).toBe('113 g');
  });
  it('keeps the label unit first for pesticide stock', () => {
    expect(formatStockQuantity(2.5, 'gal', { units: 'metric' }, { labelUnit: true })).toBe(
      '2.5 gal (9.5 L)'
    );
  });
  it('never converts counts, bags or metric units', () => {
    expect(formatStockQuantity(3, 'bag-50lb', { units: 'metric' })).toBe('3.0 bag-50lb');
    expect(formatStockQuantity(1000, 'seeds', { units: 'metric' }, { digits: 0 })).toBe(
      '1,000 seeds'
    );
    expect(formatStockQuantity(2, 'kg', { units: 'metric' })).toBe('2.0 kg');
  });
  it('renders an em dash for missing values', () => {
    expect(formatStockQuantity(null, 'lb', { units: 'metric' })).toBe('—');
  });
});

describe('isLabelUnitCategory', () => {
  it('flags pesticide categories only', () => {
    expect(isLabelUnitCategory('herbicide')).toBe(true);
    expect(isLabelUnitCategory('fungicide')).toBe(true);
    expect(isLabelUnitCategory('fertilizer')).toBe(false);
    expect(isLabelUnitCategory(null)).toBe(false);
  });
});

describe('formatRateText', () => {
  it('passes US rates through unchanged', () => {
    expect(formatRateText(22, 'fl oz/ac')).toBe('22 fl oz/ac');
  });
  it('shows label rates label-first for metric users', () => {
    expect(formatRateText(22, 'fl oz/ac', { units: 'metric' }, { labelUnit: true })).toBe(
      '22 fl oz/ac (1.6 L/ha)'
    );
  });
  it('converts non-label rates outright', () => {
    expect(formatRateText(100, 'lb/acre', { units: 'metric' })).toBe('112.1 kg/ha');
    expect(formatRateText(200, 'lb-per-acre', { units: 'metric' })).toBe('224.2 kg/ha');
  });
  it('leaves unrecognised units alone', () => {
    expect(formatRateText(2, 'tons/ac', { units: 'metric' })).toBe('2 tons/ac');
  });
  it('shows a label rate code per acre (#661)', () => {
    expect(formatRateText(1.92, perAcreRateUnit('fl-oz'))).toBe('1.92 fl oz/acre');
    expect(formatRateText(1, perAcreRateUnit('pt'))).toBe('1 pt/acre');
    expect(
      formatRateText(1.92, perAcreRateUnit('fl-oz'), { units: 'metric' }, { labelUnit: true })
    ).toMatch(/^1\.92 fl oz\/acre \(.+\/ha\)$/);
  });
});

describe('seed quantities (#473)', () => {
  it('reads a seed count as seeds, whether stored as count or seeds', () => {
    expect(formatStockQuantity(120, 'seeds', DEFAULT_PREFS, { category: 'seed' })).toBe(
      '120 seeds'
    );
    expect(formatStockQuantity(1, 'count', DEFAULT_PREFS, { category: 'seed' })).toBe('1 seed');
    expect(formatStockQuantity(1500, 'count', DEFAULT_PREFS, { category: 'seed' })).toBe(
      '1,500 seeds'
    );
  });

  it('leaves weights and non-seed counts alone', () => {
    expect(formatStockQuantity(2, 'lb', DEFAULT_PREFS, { category: 'seed' })).toBe('2.0 lb');
    expect(formatStockQuantity(3, 'count', DEFAULT_PREFS, { category: 'fertilizer' })).toBe(
      '3.0 count'
    );
  });

  it('labels units for the picker', () => {
    expect(stockUnitLabel('count', 'seed')).toBe('Seeds');
    expect(stockUnitLabel('seeds', 'seed')).toBe('Seeds');
    expect(stockUnitLabel('count', 'herbicide')).toBe('Count');
    expect(stockUnitLabel('fl-oz')).toBe('fl oz');
    expect(SEED_UNITS).toEqual(['seeds', 'oz', 'lb', 'g']);
    expect(isSeedCountUnit('count', 'seed')).toBe(true);
    expect(isSeedCountUnit('oz', 'seed')).toBe(false);
  });
});

describe('Spanish unit words', () => {
  it('translates seed and bag words but keeps symbols', () => {
    const es = { ...DEFAULT_PREFS, locale: 'es' };
    expect(formatStockQuantity(1, 'seeds', es, { category: 'seed' })).toBe('1 semilla');
    expect(formatStockQuantity(200, 'count', es, { category: 'seed' })).toBe('200 semillas');
    expect(formatStockQuantity(3, 'bag', es)).toBe('3 bolsas');
    expect(formatStockQuantity(2, 'gal', es)).toBe('2.0 gal');
    expect(formatStockQuantity(2, 'bag', DEFAULT_PREFS, { locale: 'es' })).toBe('2 bolsas');
    expect(stockUnitLabel('bag-50lb', null, 'es')).toBe('Bolsa de 50 lb');
    expect(stockUnitLabel('count', 'seed', 'es')).toBe('Semillas');
    expect(stockUnitLabel('lb', null, 'es')).toBe('lb');
  });
});
