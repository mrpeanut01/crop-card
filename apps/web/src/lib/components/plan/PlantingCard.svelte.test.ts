/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import PlantingCard from './PlantingCard.svelte';
import type { PlantingRecord } from '$lib/db/blocks';

const PLANTING: PlantingRecord = {
  id: 'p1',
  blockId: 'b1',
  cropPluginId: 'corn-bloody-butcher',
  varietyDisplayName: 'Bloody Butcher',
  plantingDate: Date.UTC(2026, 4, 1, 12),
  quantityPlanted: 400,
  quantityUnit: 'seeds'
};

describe('PlantingCard (#121)', () => {
  it('renders the italic variety · role sub-line', () => {
    const { container } = render(PlantingCard, {
      planting: PLANTING,
      cropName: 'Dent corn',
      role: 'Anchor',
      stage: 'V6 · Six leaf'
    });
    expect(container.querySelector('.pc-sub')?.textContent).toBe('Dent corn · Anchor');
  });

  it('omits the crop name from the sub-line when it matches the title', () => {
    const { container } = render(PlantingCard, {
      planting: PLANTING,
      cropName: 'Bloody Butcher',
      role: 'Primary'
    });
    expect(container.querySelector('.pc-sub')?.textContent).toBe('Primary');
  });

  it('always renders the five metadata cells in order', () => {
    const { container } = render(PlantingCard, {
      planting: PLANTING,
      daysToMaturity: 100,
      role: 'Companion',
      stage: 'V6 · Six leaf'
    });
    const keys = [...container.querySelectorAll('.pc-cell .k')].map((k) => k.textContent);
    expect(keys).toEqual(['Role', 'Stage', 'Planted', 'Harvest', 'Area']);
    expect(container.querySelectorAll('.pc-cell .v')[0].textContent).toBe('Companion');
    expect(screen.getByText('V6 · Six leaf')).toBeInTheDocument();
    expect(screen.getByText('400 seeds')).toBeInTheDocument();
  });

  it('shows placeholders when role / stage are unknown', () => {
    const { container } = render(PlantingCard, { planting: PLANTING });
    const values = [...container.querySelectorAll('.pc-cell .v')].map((v) => v.textContent);
    expect(values[0]).toBe('—');
    expect(values[1]).toBe('—');
  });
});
