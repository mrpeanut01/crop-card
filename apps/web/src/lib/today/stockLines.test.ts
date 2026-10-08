import { describe, expect, it } from 'vitest';
import { expiringStockLine, lowStockLine } from './stockLines';

const US = { units: 'us' as const, locale: undefined };

describe('today stock lines (#620)', () => {
  it('pluralizes bags on both numbers', () => {
    expect(
      lowStockLine({ onHand: 2, defaultUnit: 'bag', reorderThreshold: 3, category: 'feed' }, US)
    ).toBe('2 bags on hand (reorder at 3 bags)');
    expect(
      lowStockLine({ onHand: 1, defaultUnit: 'bag', reorderThreshold: 1, category: 'feed' }, US)
    ).toBe('1 bag on hand (reorder at 1 bag)');
  });

  it('reads seed counts as seeds and follows Spanish', () => {
    expect(
      lowStockLine(
        { onHand: 2, defaultUnit: 'bag', reorderThreshold: 3, category: 'feed' },
        { units: 'us', locale: 'es' }
      )
    ).toBe('2 bolsas en existencia (reordenar en 3 bolsas)');
    expect(
      expiringStockLine({ balance: 500, unit: 'count', daysUntilExpiry: 1, category: 'seed' }, US)
    ).toBe('500 seeds, 1 day left');
  });

  it('keeps abbreviated units as they are', () => {
    expect(
      lowStockLine(
        { onHand: 1.5, defaultUnit: 'gal', reorderThreshold: 2, category: 'herbicide' },
        US
      )
    ).toBe('1.5 gal on hand (reorder at 2 gal)');
  });
});
