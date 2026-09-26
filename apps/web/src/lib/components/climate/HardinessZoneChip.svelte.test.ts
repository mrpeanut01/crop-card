/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import HardinessZoneChip from './HardinessZoneChip.svelte';
import type { HardinessZoneView } from '$lib/climate/zone';

const estimate: HardinessZoneView = {
  label: '7a',
  provenance: 'data',
  stationName: 'Washington DC Dulles AP, VA',
  distanceMi: 6.2,
  extremeMinF: 3.9,
  estimate: '7a'
};

describe('HardinessZoneChip', () => {
  it('shows the station estimate with data provenance', () => {
    const { container } = render(HardinessZoneChip, { props: { zone: estimate } });
    expect(screen.getByTestId('hardiness-zone')).toHaveTextContent(
      'Zone 7a (approx., from Washington DC Dulles AP, VA)'
    );
    const chip = container.querySelector('[data-provenance="data"]')!;
    expect(chip.getAttribute('aria-label')).toMatch(/Weather service/);
    expect(chip.getAttribute('aria-label')).toMatch(/NOAA station averages, 1991-2020 · 6 mi/);
    expect(container.textContent).not.toMatch(/USDA/);
  });

  it('shows the owner’s own zone as manual', () => {
    const { container } = render(HardinessZoneChip, {
      props: { zone: { ...estimate, label: '6b', provenance: 'manual', stationName: null } }
    });
    expect(screen.getByTestId('hardiness-zone')).toHaveTextContent('Zone 6b (your setting)');
    expect(container.querySelector('[data-provenance="manual"]')).not.toBeNull();
  });

  it('renders nothing when the zone is unknown', () => {
    const { container } = render(HardinessZoneChip, { props: { zone: null } });
    expect(container.querySelector('[data-testid="hardiness-zone"]')).toBeNull();
  });
});
