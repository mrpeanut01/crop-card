/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import InvTypeChip from './InvTypeChip.svelte';

describe('InvTypeChip — Phase 27A 5-chip type-swap row', () => {
  it('renders all 5 canonical inventory types', () => {
    const { getByRole } = render(InvTypeChip, {
      activeType: 'pesticide',
      onTypeChange: () => {}
    });
    for (const label of ['Pesticides', 'Fertility', 'Seeds', 'Crops', 'Sprayers']) {
      expect(getByRole('tab', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('marks only the active type as aria-selected', () => {
    const { getByRole } = render(InvTypeChip, {
      activeType: 'seed',
      onTypeChange: () => {}
    });
    expect(getByRole('tab', { name: /Seeds/ })).toHaveAttribute('aria-selected', 'true');
    expect(getByRole('tab', { name: /Pesticides/ })).toHaveAttribute('aria-selected', 'false');
  });

  it('invokes onTypeChange with the clicked type', async () => {
    const onTypeChange = vi.fn();
    const { getByRole } = render(InvTypeChip, {
      activeType: 'pesticide',
      onTypeChange
    });
    await fireEvent.click(getByRole('tab', { name: /Crops/ }));
    expect(onTypeChange).toHaveBeenCalledWith('crop');
  });

  it('renders per-type counts when countByType is provided', () => {
    const { getByText } = render(InvTypeChip, {
      activeType: 'pesticide',
      onTypeChange: () => {},
      countByType: { pesticide: 12, seed: 3 }
    });
    expect(getByText('12')).toBeInTheDocument();
    expect(getByText('3')).toBeInTheDocument();
  });
});
