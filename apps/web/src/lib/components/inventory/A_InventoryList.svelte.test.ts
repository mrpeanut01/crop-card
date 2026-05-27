/**
 * @vitest-environment jsdom
 *
 * Sprint 7 / Phase 27B — A_InventoryList per-type rendering.
 * Locks the chrome → 5-chip + (where applicable) Stock/Catalog toggle +
 * KPI strip + table. Per-type column sets verified per spec.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
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
    const { getByText } = render(A_InventoryList, {
      type: 'pesticide',
      mode: 'stock',
      counts,
      rows: []
    });
    expect(getByText('Pesticides')).toBeInTheDocument();
    expect(getByText('Fertility')).toBeInTheDocument();
    expect(getByText('Seeds')).toBeInTheDocument();
    expect(getByText('Crops')).toBeInTheDocument();
    expect(getByText('Sprayers')).toBeInTheDocument();
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
    const { getByText } = render(A_InventoryList, {
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
    expect(getByText('Item')).toBeInTheDocument();
    expect(getByText('On hand')).toBeInTheDocument();
    expect(getByText('Lots')).toBeInTheDocument();
    expect(getByText('Roundup PowerMAX')).toBeInTheDocument();
  });

  it('renders crop catalog columns (Archetype + Family + DTM)', () => {
    const { getByText } = render(A_InventoryList, {
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
    expect(getByText('Archetype')).toBeInTheDocument();
    expect(getByText('Family')).toBeInTheDocument();
    expect(getByText('DTM')).toBeInTheDocument();
    expect(getByText('continuous-harvest-fruit')).toBeInTheDocument();
    expect(getByText(/80.*85.*d/)).toBeInTheDocument();
  });

  it('renders sprayer columns (Sprayer · Nozzle · Tank · Last cal · GPA · Status)', () => {
    const { getByText } = render(A_InventoryList, {
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
    expect(getByText('Sprayer')).toBeInTheDocument();
    expect(getByText('Nozzle')).toBeInTheDocument();
    expect(getByText('Tank')).toBeInTheDocument();
    expect(getByText('GPA')).toBeInTheDocument();
    expect(getByText('Backpack 4-gal')).toBeInTheDocument();
    expect(getByText('OK')).toBeInTheDocument();
  });
});
