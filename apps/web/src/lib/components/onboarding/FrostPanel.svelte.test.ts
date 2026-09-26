/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import FrostPanel from './FrostPanel.svelte';

function hidden(container: HTMLElement, name: string): string | null {
  return (
    container.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)?.value ?? null
  );
}

describe('FrostPanel', () => {
  it('fills station dates with data provenance for a Loudoun pin', async () => {
    const { container } = render(FrostPanel, {
      props: { lat: 39.137, lon: -77.714, mode: 'auto' }
    });
    await waitFor(() => expect(hidden(container, 'lastFrost')).toMatch(/^\d{2}-\d{2}$/), {
      timeout: 5000
    });
    expect(container.querySelector('[data-provenance="data"]')).not.toBeNull();
    expect(screen.getByText(/using NOAA's 1991-2020 climate normals/)).toBeInTheDocument();
    expect(hidden(container, 'frostBasis')).toBe('lookup');
    expect(hidden(container, 'frostProbability')).toBe('median');
    expect(screen.queryByText('These dates are fine for now')).toBeNull();
  });

  it('switches to the cautious columns', async () => {
    const { container } = render(FrostPanel, {
      props: { lat: 39.137, lon: -77.714, mode: 'auto' }
    });
    await waitFor(() => expect(hidden(container, 'lastFrost')).toMatch(/^\d{2}-\d{2}$/), {
      timeout: 5000
    });
    const median = hidden(container, 'lastFrost');
    await fireEvent.click(screen.getByLabelText(/Cautious dates/));
    await waitFor(() => expect(hidden(container, 'frostProbability')).toBe('cautious'));
    await waitFor(() => expect(hidden(container, 'lastFrost')).not.toBe(median), {
      timeout: 5000
    });
    expect(Number(hidden(container, 'lastFrost')!.replace('-', ''))).toBeGreaterThan(
      Number(median!.replace('-', ''))
    );
  });

  it('explains a Gulf-coast season across the new year without asking to confirm', async () => {
    const { container } = render(FrostPanel, {
      props: { lat: 30.2506, lon: -88.0775, mode: 'auto' }
    });
    await waitFor(() => expect(hidden(container, 'lastFrost')).toBe('01-31'), { timeout: 5000 });
    expect(hidden(container, 'firstFrost')).toBe('01-06');
    expect(screen.getByTestId('frost-crosses-year')).toHaveTextContent(
      /growing season runs from one year into the next/
    );
    expect(screen.queryByText('These dates are fine for now')).toBeNull();
  });

  it('names the hard-frost window when both hard frosts land in January', async () => {
    const { container } = render(FrostPanel, {
      props: { lat: 30.69, lon: -88.04, mode: 'auto' }
    });
    await waitFor(() => expect(hidden(container, 'lastHardFrost')).toMatch(/^01-/), {
      timeout: 5000
    });
    expect(hidden(container, 'firstHardFrost')).toMatch(/^01-/);
    expect(container.querySelector('.hard')?.textContent).toMatch(
      /Hard frost \(24 °F or colder\): usually only between about Jan \d+ and Jan \d+\./
    );
  });

  it('asks for confirmation when there is no station nearby', async () => {
    render(FrostPanel, { props: { lat: 30, lon: -45, mode: 'auto' } });
    const box = await screen.findByLabelText('These dates are fine for now', undefined, {
      timeout: 5000
    });
    expect(screen.getByText(/No weather station within 50 miles/)).toBeInTheDocument();
    expect(box).not.toBeChecked();
  });

  it('shows saved dates with their provenance until asked to suggest', async () => {
    const { container } = render(FrostPanel, {
      props: {
        lat: 39.137,
        lon: -77.714,
        mode: 'manual',
        stored: {
          values: {
            lastFrost: { value: '04-28', provenance: 'manual' },
            firstFrost: { value: '10-24', provenance: 'data' },
            lastHardFrost: { value: null, provenance: 'fallback' },
            firstHardFrost: { value: null, provenance: 'fallback' }
          },
          source: 'Dulles Intl AP, VA · 6 mi',
          probability: 'median'
        }
      }
    });
    expect(screen.getByTestId('frost-lastFrost')).toHaveTextContent('Apr 28');
    expect(hidden(container, 'frostBasis')).toBe('stored');
    expect(container.querySelector('[data-provenance="manual"]')).not.toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Suggest from my location' }));
    expect(hidden(container, 'frostBasis')).toBe('lookup');
    await waitFor(() => expect(hidden(container, 'lastFrost')).not.toBe('04-28'), {
      timeout: 5000
    });
  });
});
