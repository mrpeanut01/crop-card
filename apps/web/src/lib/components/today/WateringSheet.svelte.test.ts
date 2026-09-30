/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import WateringSheet from './WateringSheet.svelte';

function summary(areaSized: boolean) {
  return {
    area: { id: 'f1', name: 'Kitchen', kind: 'garden', sized: areaSized },
    beds: [{ id: 'b1', name: 'Bed 1', sized: true }],
    target: { inches: 1, provenance: 'fallback' },
    targetSource: null,
    canSetTarget: false,
    canLog: true,
    lastGaugeAt: null,
    areas: [],
    gauges: [],
    logs: []
  };
}

function fetcherFor(areaSized: boolean): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(summary(areaSized)), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as typeof fetch;
}

describe('WateringSheet gallons', () => {
  it('says gallons need a size when the Area has none', async () => {
    render(WateringSheet, {
      mode: 'log-watering',
      fieldId: 'f1',
      onDone: () => {},
      fetcher: fetcherFor(false)
    });
    await waitFor(() => expect(screen.getByLabelText('Where')).toBeTruthy());
    await fireEvent.click(screen.getByLabelText('Gallons'));
    expect(screen.getByTestId('gallons-no-size').textContent).toContain('This Area has no size');
  });

  it('says nothing extra for a sized Area', async () => {
    render(WateringSheet, {
      mode: 'log-watering',
      fieldId: 'f1',
      onDone: () => {},
      fetcher: fetcherFor(true)
    });
    await waitFor(() => expect(screen.getByLabelText('Where')).toBeTruthy());
    await fireEvent.click(screen.getByLabelText('Gallons'));
    expect(screen.queryByTestId('gallons-no-size')).toBeNull();
  });
});
