import { describe, expect, it } from 'vitest';
import {
  applyProductChoice,
  applyProductChoices,
  buildShoppingList,
  onHandInUnit,
  stockCoverage,
  stockRowsFrom
} from './inputsChoice';
import type { InputsPlanApplication } from './inputsPlan';

function app(over: Partial<InputsPlanApplication> = {}): InputsPlanApplication {
  return {
    id: 'a1',
    plantingId: 'p1',
    blockId: 'b1',
    cropPluginId: 'beans',
    slot: 'pre-emergent',
    productPluginId: 'roundup',
    productDisplayName: 'Roundup',
    productCategory: 'herbicide',
    windowStartMs: 0,
    windowEndMs: 1,
    applicationDateMs: 0,
    rateAmount: 2,
    rateUnit: 'pt',
    acres: 1,
    totalAmount: 2,
    rationale: '',
    productSource: 'plugin',
    options: [
      {
        pluginId: 'roundup',
        displayName: 'Roundup',
        rateAmount: 2,
        rateUnit: 'pt',
        totalAmount: 2,
        onHand: 0,
        stock: 'none'
      },
      {
        pluginId: 'liberty',
        displayName: 'Liberty',
        rateAmount: 3,
        rateUnit: 'pt',
        totalAmount: 3,
        onHand: 5,
        stock: 'enough'
      }
    ],
    ...over
  };
}

describe('product choice (#480)', () => {
  it('swaps in the chosen option and tags it manual', () => {
    const next = applyProductChoice(app(), 'liberty')!;
    expect(next).toMatchObject({
      productPluginId: 'liberty',
      productDisplayName: 'Liberty',
      rateAmount: 3,
      totalAmount: 3,
      productSource: 'manual'
    });
  });

  it('refuses a product that is not an option', () => {
    expect(applyProductChoice(app(), 'two-four-d')).toBeNull();
    expect(applyProductChoices([app()], { a1: 'two-four-d' })[0].productPluginId).toBe('roundup');
  });

  it('rebuilds the shopping list from the choices', () => {
    const chosen = applyProductChoices([app()], { a1: 'liberty' });
    const list = buildShoppingList(chosen, [{ pluginId: 'liberty', onHand: 5 }]);
    expect(list).toEqual([
      expect.objectContaining({ pluginId: 'liberty', totalNeeded: 3, onHand: 5, shortfall: 0 })
    ]);
  });

  it('grades stock against the need', () => {
    expect(stockCoverage(0, 2)).toBe('none');
    expect(stockCoverage(1, 2)).toBe('some');
    expect(stockCoverage(2, 2)).toBe('enough');
    expect(stockCoverage(1, null)).toBe('some');
  });
});

describe('stock units are converted before they are compared (#480)', () => {
  it('converts on-hand stock into the rate unit', () => {
    expect(onHandInUnit([{ amount: 32, unit: 'fl-oz' }], 'pt')).toBe(2);
    expect(onHandInUnit([{ amount: 1, unit: 'gal' }], 'qt')).toBe(4);
    expect(onHandInUnit([], 'pt')).toBe(0);
    expect(onHandInUnit([{ amount: 5, unit: 'lb' }], 'pt')).toBeNull();
  });

  it('a 2 pt stock in fl oz against a 3 pt need is a 1 pt shortfall', () => {
    const list = buildShoppingList(
      [app({ rateAmount: 1, totalAmount: 3, rateUnit: 'pt' })],
      [{ pluginId: 'roundup', onHand: 32, unit: 'fl-oz' }]
    );
    expect(list[0]).toMatchObject({ unit: 'pt', totalNeeded: 3, onHand: 2, shortfall: 1 });
    expect(stockCoverage(onHandInUnit([{ amount: 32, unit: 'fl-oz' }], 'pt'), 3)).toBe('some');
  });

  it('stock kept in gal is not a false shortfall against a fl oz rate', () => {
    const list = buildShoppingList(
      [app({ rateAmount: 22, totalAmount: 22, rateUnit: 'fl-oz' })],
      [{ pluginId: 'roundup', onHand: 1, unit: 'gal' }]
    );
    expect(list[0]).toMatchObject({ onHand: 128, shortfall: 0 });
  });

  it('flags stock it cannot convert instead of counting it', () => {
    const list = buildShoppingList(
      [app({ totalAmount: 2, rateUnit: 'pt' })],
      [{ pluginId: 'roundup', onHand: 10, unit: 'lb' }]
    );
    expect(list[0]).toMatchObject({ onHand: 0, shortfall: 2, stockUnitMismatch: 'lb' });
  });

  it('reads both the new and the saved-draft stock shapes', () => {
    expect(stockRowsFrom({ a: [{ amount: 2, unit: 'pt' }], b: 3 })).toEqual([
      { pluginId: 'a', onHand: 2, unit: 'pt' },
      { pluginId: 'b', onHand: 3 }
    ]);
  });
});
