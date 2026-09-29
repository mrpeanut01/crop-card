import { describe, expect, it } from 'vitest';
import { availableQuantityText } from './quantityStatus';

describe('availableQuantityText', () => {
  it('puts the unit before the status', () => {
    expect(availableQuantityText({ existing: 12, ordered: 0, planned: 0 }, 'seeds')).toBe(
      '12 seeds on hand'
    );
  });
  it('labels each part and reads legacy count as seeds', () => {
    expect(availableQuantityText({ existing: 5, ordered: 50, planned: 0 }, 'count')).toBe(
      '5 seeds on hand + 50 seeds ordered'
    );
  });
  it('uses singular and weight units', () => {
    expect(availableQuantityText({ existing: 1, ordered: 0, planned: 0 }, 'seeds')).toBe(
      '1 seed on hand'
    );
    expect(availableQuantityText({ existing: 0, ordered: 0, planned: 1.5 }, 'lb')).toBe(
      '1.5 lb planned'
    );
    expect(availableQuantityText({ existing: 0, ordered: 0, planned: 0 }, 'lb')).toBe(
      'Not counted yet'
    );
  });
});
