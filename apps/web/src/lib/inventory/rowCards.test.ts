import { describe, expect, it } from 'vitest';
import { inventoryDetailHref, inventoryRowCard } from './rowCards';
import type { InventoryRow } from '../../routes/inventory/+page.server';

const prefs = { timeZone: 'America/New_York', units: 'us' as const };

const STOCK: InventoryRow = {
  kind: 'stock',
  id: 'sk 1',
  displayName: 'Sevin XLR',
  category: 'insecticide',
  onHand: 1.5,
  defaultUnit: 'qt',
  lotCount: 2,
  isLow: true,
  earliestExpiry: Date.UTC(2027, 2, 1)
};

describe('inventoryRowCard', () => {
  it('stock rows carry the table columns, a Low pill and the detail link', () => {
    const card = inventoryRowCard(STOCK, 'pesticide', prefs, 0);
    expect(card.kind).toBe('stock');
    expect(card.title).toBe('Sevin XLR');
    expect(card.href).toBe('/inventory/pesticide/sk%201');
    expect(card.facts.map((f) => f.label)).toEqual(['Kind', 'On hand', 'Lots', 'Expires']);
    expect(card.facts[2].value).toBe('2');
    expect(card.facts[3].value).toBe('Mar 1, 2027');
    expect(card.status).toEqual({ label: 'Low', tone: 'rust' });
    expect(inventoryRowCard({ ...STOCK, isLow: false }, 'pesticide', prefs).status).toBeUndefined();
  });

  it('seed rows show the crop, not the internal stock category (#472)', () => {
    const seed: InventoryRow = {
      ...STOCK,
      category: 'seed',
      displayName: 'Cherokee Purple Tomato',
      defaultUnit: 'seeds',
      pluginId: 'tomato-cherokee-purple',
      cropName: 'Tomato, Cherokee Purple'
    };
    const card = inventoryRowCard(seed, 'seed', prefs, 0);
    expect(card.facts[0]).toEqual({ label: 'Crop', value: 'Tomato, Cherokee Purple' });
    expect(card.facts.some((f) => f.label === 'Category')).toBe(false);
    expect(
      inventoryRowCard({ ...seed, cropName: undefined }, 'seed', prefs, 0).facts[0].value
    ).toBe('—');
  });

  it('catalog rows use the plugin id for the link and the crop column names', () => {
    const row: InventoryRow = {
      kind: 'catalog',
      pluginId: 'tomato-cherokee-purple',
      displayName: 'Cherokee Purple',
      pluginType: 'crop',
      archetype: 'continuous-harvest-fruit',
      cropFamily: 'solanaceae',
      daysToMaturity: { min: 80, max: 85 },
      hash: 'x'
    };
    const card = inventoryRowCard(row, 'crop', prefs);
    expect(inventoryDetailHref('crop', row)).toBe('/inventory/crop/tomato-cherokee-purple');
    expect(card.facts.map((f) => [f.label, f.value])).toEqual([
      ['Id', 'tomato-cherokee-purple'],
      ['Archetype', 'continuous-harvest-fruit'],
      ['Family', 'solanaceae'],
      ['DTM', '80–85 d']
    ]);
    const pesticide = inventoryRowCard(
      {
        ...row,
        pluginType: 'herbicide',
        archetype: undefined,
        daysToMaturity: undefined,
        version: '1.2.0'
      },
      'pesticide',
      prefs
    );
    expect(pesticide.facts.map((f) => f.label)).toEqual(['Id', 'Type', 'Source', 'Version']);
    expect(pesticide.facts[3].value).toBe('1.2.0');
  });

  it('seed rows read their count as seeds (#473)', () => {
    const seed = inventoryRowCard(
      { ...STOCK, category: 'seed', defaultUnit: 'count', onHand: 250, isLow: false },
      'seed',
      prefs
    );
    expect(seed.facts[1].value).toBe('250 seeds');
  });

  it('shows ordered and planned seed beside on hand, so an order never reads as lost (#475 review)', () => {
    const seed = inventoryRowCard(
      {
        ...STOCK,
        category: 'seed',
        defaultUnit: 'seeds',
        onHand: 0,
        onOrder: 200,
        planned: 50,
        isLow: false
      },
      'seed',
      prefs
    );
    expect(seed.facts[1].value).toBe('0 seeds');
    expect(seed.facts.find((f) => f.label === 'Coming')?.value).toBe(
      '200 seeds ordered, 50 seeds planned'
    );
  });

  it('adds no Coming fact when nothing is expected', () => {
    const seed = inventoryRowCard(
      { ...STOCK, category: 'seed', defaultUnit: 'seeds', onHand: 5, isLow: false },
      'seed',
      prefs
    );
    expect(seed.facts.some((f) => f.label === 'Coming')).toBe(false);
  });
});
