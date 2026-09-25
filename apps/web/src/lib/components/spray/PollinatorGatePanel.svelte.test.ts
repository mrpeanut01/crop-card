/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import PollinatorGatePanel from './PollinatorGatePanel.svelte';
import { checkPollinatorProtection } from '$lib/safety/pollinatorProtection';
import { checkNearbyPollinatorBlocks, type NeighborBlock } from '$lib/pollinator/nearbyBlocks';

const result = checkPollinatorProtection({
  products: [
    {
      pluginId: 'pyr',
      pollinator: { beeToxicity: 'highly-toxic', bloomRestriction: 'none' }
    }
  ],
  bloomStatus: 'not-in-bloom',
  applicationTime: new Date('2026-06-22T04:00:00Z'),
  sunTimes: null
});

const neighbors: NeighborBlock[] = [
  {
    blockId: 'orchard',
    name: 'Orchard',
    distanceFt: 3200,
    crops: [{ cropPluginId: 'apple', displayName: 'Apple', inBloomNow: false, beeAttractive: true }]
  },
  {
    blockId: 'squash',
    name: 'Squash patch',
    distanceFt: 420,
    crops: [
      { cropPluginId: 'squash', displayName: 'Squash', inBloomNow: true, beeAttractive: true }
    ]
  },
  {
    blockId: 'unmapped',
    name: 'Back field',
    distanceFt: null,
    crops: [
      { cropPluginId: 'clover', displayName: 'Clover', inBloomNow: true, beeAttractive: true }
    ]
  }
];

function renderPanel(nearby?: ReturnType<typeof checkNearbyPollinatorBlocks>) {
  return render(PollinatorGatePanel, {
    props: {
      result,
      bloomStatus: 'not-in-bloom',
      attestedNoForagers: false,
      bloomingCrops: [],
      hasPluginData: true,
      sunsetLabel: null,
      sunriseLabel: null,
      nearby
    }
  });
}

describe('PollinatorGatePanel — nearby blocks tile', () => {
  it('lists nearby blocks nearest first with distance, reason and crops, then unknown distance', () => {
    renderPanel(checkNearbyPollinatorBlocks({ beeToxicity: 'highly-toxic', neighbors }));
    const tile = screen.getByTestId('pollinator-check-nearby-blocks');
    expect(tile.dataset.status).toBe('warn');
    expect(tile.getAttribute('role')).toBeNull();
    const rows = within(tile).getAllByRole('listitem');
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      'nearby-block-squash',
      'nearby-block-orchard',
      'nearby-block-unmapped'
    ]);
    expect(rows[0].textContent).toMatch(/Squash patch\s*420 ft\s*in bloom · Squash/);
    expect(rows[1].textContent).toMatch(/0\.6 mi\s*bee-attractive · Apple/);
    expect(rows[2].textContent).toMatch(/distance unknown/);
    const prov = Array.from(tile.querySelectorAll('[data-provenance]')).map(
      (el) => (el as HTMLElement).dataset.provenance
    );
    expect(prov).toEqual(['plugin', 'data']);
  });

  it('renders a pass tile with no rows when nothing attractive is in range', () => {
    renderPanel(checkNearbyPollinatorBlocks({ beeToxicity: 'highly-toxic', neighbors: [] }));
    const tile = screen.getByTestId('pollinator-check-nearby-blocks');
    expect(tile.dataset.status).toBe('pass');
    expect(within(tile).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('omits the tile when no advisory is supplied', () => {
    renderPanel();
    expect(screen.queryByTestId('pollinator-check-nearby-blocks')).toBeNull();
  });
});
