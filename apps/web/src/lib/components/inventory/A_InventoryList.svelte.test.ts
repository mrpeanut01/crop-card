/**
 * @vitest-environment jsdom
 *
 * Sprint 7 / Phase 27B — A_InventoryList per-type rendering.
 * Locks the chrome → 5-chip + (where applicable) Stock/Catalog toggle +
 * KPI strip + table. Per-type column sets verified per spec.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import A_InventoryList from './A_InventoryList.svelte';

const counts = {
  pesticide: 12,
  fertility: 4,
  seed: 27,
  crop: 376,
  sprayer: 2
};

describe('A_InventoryList — Phase 27B', () => {
  it('renders all 5 type chips with counts', () => {
    const { getByText, getByRole } = render(A_InventoryList, {
      type: 'pesticide',
      mode: 'stock',
      counts,
      rows: []
    });
    expect(getByRole('tab', { name: /^Pesticides/ })).toBeInTheDocument();
    expect(getByRole('tab', { name: /^Fertility/ })).toBeInTheDocument();
    expect(getByRole('tab', { name: /^Seeds/ })).toBeInTheDocument();
    expect(getByRole('tab', { name: /^Crops/ })).toBeInTheDocument();
    expect(getByRole('tab', { name: /^Sprayers/ })).toBeInTheDocument();
    // Per-type count badges.
    expect(getByText('12')).toBeInTheDocument();
    expect(getByText('376')).toBeInTheDocument();
  });

  it('shows Stock/Catalog toggle for pesticide/fertility/seed', () => {
    const { getByRole } = render(A_InventoryList, {
      type: 'pesticide',
      mode: 'stock',
      counts,
      rows: []
    });
    expect(getByRole('group', { name: /Stock vs catalog/ })).toBeInTheDocument();
  });

  it('hides Stock/Catalog toggle for crop (catalog-only) + sprayer (asset-only)', () => {
    const cropRender = render(A_InventoryList, {
      type: 'crop',
      mode: 'catalog',
      counts,
      rows: []
    });
    expect(cropRender.queryByRole('group', { name: /Stock vs catalog/ })).toBeNull();

    const sprayerRender = render(A_InventoryList, {
      type: 'sprayer',
      mode: 'stock',
      counts,
      rows: []
    });
    expect(sprayerRender.queryByRole('group', { name: /Stock vs catalog/ })).toBeNull();
  });

  it('renders pesticide stock columns', () => {
    const { getByRole, getByTestId } = render(A_InventoryList, {
      type: 'pesticide',
      mode: 'stock',
      counts,
      rows: [
        {
          kind: 'stock',
          id: 'sk1',
          displayName: 'Roundup PowerMAX',
          category: 'herbicide',
          onHand: 2.5,
          defaultUnit: 'gal',
          lotCount: 1,
          isLow: false
        }
      ] as never
    });
    const table = within(getByRole('table'));
    expect(table.getByText('Item')).toBeInTheDocument();
    expect(table.getByText('On hand')).toBeInTheDocument();
    expect(table.getByText('Lots')).toBeInTheDocument();
    expect(table.getByText('Roundup PowerMAX')).toBeInTheDocument();

    const cards = within(getByTestId('inventory-cards'));
    expect(cards.getByRole('link', { name: 'Roundup PowerMAX' })).toHaveAttribute(
      'href',
      '/inventory/pesticide/sk1'
    );
    expect(cards.getByText('On hand')).toBeInTheDocument();
    expect(cards.getByText('Lots')).toBeInTheDocument();
    expect(cards.getByText('Expires')).toBeInTheDocument();
  });

  it('renders crop catalog columns (Archetype + Family + DTM)', () => {
    const { getByRole, getByTestId } = render(A_InventoryList, {
      type: 'crop',
      mode: 'catalog',
      counts,
      rows: [
        {
          kind: 'catalog',
          pluginId: 'tomato-cherokee-purple',
          displayName: 'Cherokee Purple',
          pluginType: 'crop',
          archetype: 'continuous-harvest-fruit',
          cropFamily: 'solanaceae',
          daysToMaturity: { min: 80, max: 85 },
          hash: 'abc'
        }
      ] as never
    });
    const table = within(getByRole('table'));
    expect(table.getByText('Archetype')).toBeInTheDocument();
    expect(table.getByText('Family')).toBeInTheDocument();
    expect(table.getByText('DTM')).toBeInTheDocument();
    expect(table.getByText('continuous-harvest-fruit')).toBeInTheDocument();
    expect(table.getByText(/80.*85.*d/)).toBeInTheDocument();

    const cards = within(getByTestId('inventory-cards'));
    expect(cards.getByRole('link', { name: 'Cherokee Purple' })).toHaveAttribute(
      'href',
      '/inventory/crop/tomato-cherokee-purple'
    );
    expect(cards.getByText('continuous-harvest-fruit')).toBeInTheDocument();
    expect(cards.getByText(/80.*85.*d/)).toBeInTheDocument();
  });

  it('renders sprayer columns (Sprayer · Nozzle · Tank · Last cal · GPA · Status)', () => {
    const { getByRole, getByTestId } = render(A_InventoryList, {
      type: 'sprayer',
      mode: 'stock',
      counts,
      rows: [
        {
          kind: 'sprayer',
          id: 'eq1',
          label: 'Backpack 4-gal',
          nozzleType: 'TeeJet XR110015',
          tankGal: 4,
          measuredGpa: 17.5,
          lastCalibratedAt: Date.UTC(2026, 4, 1),
          deconRequired: false
        }
      ] as never
    });
    const table = within(getByRole('table'));
    expect(table.getByText('Sprayer')).toBeInTheDocument();
    expect(table.getByText('Nozzle')).toBeInTheDocument();
    expect(table.getByText('Tank')).toBeInTheDocument();
    expect(table.getByText('GPA')).toBeInTheDocument();
    expect(table.getByText('Backpack 4-gal')).toBeInTheDocument();
    expect(table.getByText('OK')).toBeInTheDocument();

    const cards = within(getByTestId('inventory-cards'));
    expect(cards.getByRole('link', { name: 'Backpack 4-gal' })).toHaveAttribute(
      'href',
      '/inventory/sprayer/eq1'
    );
    expect(cards.getByText('TeeJet XR110015')).toBeInTheDocument();
    expect(cards.getByText('17.5')).toBeInTheDocument();
    expect(cards.getByText('OK')).toBeInTheDocument();
  });

  it('search filters the table and the phone cards alike', async () => {
    const { getByRole, getByTestId } = render(A_InventoryList, {
      type: 'pesticide',
      mode: 'stock',
      counts,
      rows: [
        {
          kind: 'stock',
          id: 'a',
          displayName: 'Sevin',
          category: 'insecticide',
          onHand: 1,
          defaultUnit: 'lb',
          lotCount: 1,
          isLow: true
        },
        {
          kind: 'stock',
          id: 'b',
          displayName: 'Copper',
          category: 'fungicide',
          onHand: 2,
          defaultUnit: 'lb',
          lotCount: 1,
          isLow: false
        }
      ] as never
    });
    await fireEvent.input(getByRole('searchbox'), { target: { value: 'sev' } });
    expect(within(getByRole('table')).queryByText('Copper')).toBeNull();
    const cards = within(getByTestId('inventory-cards'));
    expect(cards.getAllByRole('article')).toHaveLength(1);
    expect(cards.getByText('Low')).toBeInTheDocument();
  });

  it('swaps the empty table for the add-a-kind card grid, inside the same chrome', () => {
    const { getByTestId, queryByRole, getByRole } = render(A_InventoryList, {
      type: 'seed',
      mode: 'stock',
      counts,
      rows: []
    });
    expect(getByTestId('inventory-empty')).toBeInTheDocument();
    expect(queryByRole('table')).toBeNull();
    expect(queryByRole('searchbox')).toBeNull();
    expect(getByRole('tablist', { name: 'Inventory type' })).toBeInTheDocument();
    expect(getByRole('link', { current: true })).toHaveAttribute('href', '/inventory/seed/add');
  });

  it('shows a helper the ask-the-owner note when the list is empty', () => {
    const { getByText, getByTestId } = render(A_InventoryList, {
      type: 'pesticide',
      mode: 'stock',
      counts,
      rows: [],
      canAdd: false
    });
    expect(getByTestId('inventory-empty')).not.toContainHTML('/inventory/pesticide/add"');
    expect(getByText(/Ask the owner to add some/)).toBeInTheDocument();
  });
});
