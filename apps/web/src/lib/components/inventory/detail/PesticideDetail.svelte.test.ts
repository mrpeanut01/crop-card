/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import PesticideDetail from './PesticideDetail.svelte';

const item = {
  id: 'st_1',
  displayName: 'Test product',
  category: 'herbicide',
  defaultUnit: 'fl-oz',
  reorderThreshold: null,
  notes: null
};

function renderWith(
  plugin: Record<string, unknown>,
  phiByCrop: Array<{ crop: string; days: number }> = []
) {
  return render(PesticideDetail, {
    item: item as never,
    lots: [],
    movements: [],
    plugin: { pluginId: 'p', displayName: 'Test product', ...plugin } as never,
    phiByCrop
  });
}

describe('PesticideDetail label intervals (#640 #661)', () => {
  it('says "Not on file" for a missing REI and PHI, not a bare dash', () => {
    const { getAllByText } = renderWith({});
    expect(getAllByText('Not on file. Check the label.')).toHaveLength(2);
  });

  it('flags a single PHI as one value for every crop', () => {
    const { getByText, getByTestId } = renderWith({ preHarvestIntervalDays: 1 });
    expect(getByText('1 d')).toBeInTheDocument();
    expect(getByTestId('phi-single-note')).toBeInTheDocument();
  });

  it('lists PHIs by crop and the longest for crops not listed', () => {
    const { getByText, getByTestId } = renderWith({ preHarvestIntervalDays: 1 }, [
      { crop: 'Corn', days: 21 },
      { crop: 'Tomato', days: 5 }
    ]);
    expect(getByText('Pre-harvest interval, Corn')).toBeInTheDocument();
    expect(getByTestId('phi-by-crop-note').textContent).toContain('21 d');
  });

  it('shows the default rate per acre', () => {
    const { getByText } = renderWith({ ratePerAcre: { amount: 1.92, unit: 'fl-oz' } });
    expect(getByText('1.92 fl oz/acre')).toBeInTheDocument();
  });
});
