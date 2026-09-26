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
    expect(card.facts.map((f) => f.label)).toEqual(['Category', 'On hand', 'Lots', 'Expires']);
    expect(card.facts[2].value).toBe('2');
    expect(card.facts[3].value).toBe('Mar 1, 2027');
    expect(card.status).toEqual({ label: 'Low', tone: 'rust' });
    expect(inventoryRowCard({ ...STOCK, isLow: false }, 'pesticide', prefs).status).toBeUndefined();
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
      ['Plugin id', 'tomato-cherokee-purple'],
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
    expect(pesticide.facts.map((f) => f.label)).toEqual(['Plugin id', 'Type', 'Source', 'Version']);
    expect(pesticide.facts[3].value).toBe('1.2.0');
  });

  it('sprayer rows show decon, OK or New like the table', () => {
    const base: InventoryRow = {
      kind: 'sprayer',
      id: 'eq1',
      label: 'Backpack',
      deconRequired: false
    };
    expect(inventoryRowCard(base, 'sprayer', prefs).status?.label).toBe('New');
    expect(
      inventoryRowCard({ ...base, lastCalibratedAt: 1, measuredGpa: 20 }, 'sprayer', prefs).status
        ?.label
    ).toBe('OK');
    const decon = inventoryRowCard({ ...base, deconRequired: true }, 'sprayer', prefs);
    expect(decon.status).toEqual({ label: 'Decon', tone: 'rust' });
    expect(decon.kind).toBe('equipment');
    expect(decon.facts.map((f) => f.label)).toEqual(['Nozzle', 'Tank', 'Last cal', 'GPA']);
  });
});
