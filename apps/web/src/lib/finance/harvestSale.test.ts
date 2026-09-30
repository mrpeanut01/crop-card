import { describe, expect, it } from 'vitest';
import { parseHarvestQuantity, recordSaleHref } from './harvestSale';

describe('parseHarvestQuantity', () => {
  it('reads a leading number and unit', () => {
    expect(parseHarvestQuantity('40 lb')).toEqual({ quantity: 40, unit: 'lb' });
    expect(parseHarvestQuantity('12.5 bu.')).toEqual({ quantity: 12.5, unit: 'bu' });
    expect(parseHarvestQuantity('3')).toEqual({ quantity: 3, unit: null });
  });

  it('gives up on anything else', () => {
    expect(parseHarvestQuantity('lots')).toBeNull();
    expect(parseHarvestQuantity('')).toBeNull();
    expect(parseHarvestQuantity(null)).toBeNull();
    expect(parseHarvestQuantity('0 lb')).toBeNull();
  });
});

describe('recordSaleHref', () => {
  it('opens an income form tied to the harvest', () => {
    expect(recordSaleHref({ harvestEventId: 'h 1', cropId: 'c1' })).toBe(
      '/finance/new?kind=income&harvestEventId=h+1&cropId=c1'
    );
  });
});
