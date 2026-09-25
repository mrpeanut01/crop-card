/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import PlanBlockHeader from './PlanBlockHeader.svelte';
import type { BlockWithPlantings } from '$lib/db/blocks';

function block(geometryGeojson?: string): BlockWithPlantings {
  return {
    id: 'b1',
    name: 'Block A',
    acres: 0.5,
    geometryGeojson,
    tillageMethod: 'conventional',
    axesLocked: false,
    plantings: []
  } as unknown as BlockWithPlantings;
}

const POLY = JSON.stringify({ type: 'Polygon', coordinates: [] });

describe('PlanBlockHeader geometry badge (#123)', () => {
  it('shows a linked "No map geometry" pill when geometry is missing', () => {
    render(PlanBlockHeader, { block: block(), geometryEditHref: '/settings/farm/map' });
    const pill = screen.getByTestId('geometry-missing');
    expect(pill.tagName).toBe('A');
    expect(pill.getAttribute('href')).toBe('/settings/farm/map');
    expect(pill).toHaveTextContent('No map geometry');
  });

  it('renders the pill without a link when the viewer cannot edit geometry', () => {
    render(PlanBlockHeader, { block: block() });
    const pill = screen.getByTestId('geometry-missing');
    expect(pill.tagName).toBe('SPAN');
    expect(pill).toHaveTextContent('No map geometry');
  });

  it('shows no pill for a block with geometry', () => {
    render(PlanBlockHeader, { block: block(POLY), geometryEditHref: '/settings/farm/map' });
    expect(screen.queryByTestId('geometry-missing')).toBeNull();
    expect(screen.queryByText('No map geometry')).toBeNull();
  });

  it('renders status + harvest-window pills when provided', () => {
    render(PlanBlockHeader, {
      block: block(POLY),
      statusLabel: 'active',
      harvestWindowLabel: 'Aug 3 – Sep 12'
    });
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('Harvest Aug 3 – Sep 12')).toBeInTheDocument();
  });
});
