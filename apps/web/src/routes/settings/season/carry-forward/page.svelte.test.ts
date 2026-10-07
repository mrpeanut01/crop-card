/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { clonePlantings, summarizeCarryForward } from '$lib/season/carryForwardPlan';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './+page.svelte';

function candidate(sourcePlantingId: string) {
  return {
    sourcePlantingId,
    blockId: 'bed-1',
    cropPluginId: 'lettuce-buttercrunch',
    varietyDisplayName: 'Buttercrunch',
    cropFamily: 'leafy-green',
    archetype: 'cut-and-come-again-leafy',
    plantingDateMs: Date.UTC(2027, 3, 1),
    status: 'harvested'
  };
}

describe('/settings/season/carry-forward', () => {
  it('renders two plantings of the same crop in one block', () => {
    const preview = summarizeCarryForward({
      fromYear: 2027,
      toYear: 2028,
      rotation: [],
      stock: [],
      clonedPlantings: clonePlantings([candidate('p1'), candidate('p2')], []),
      calibration: [],
      nCredits: []
    });
    const data = { fromYear: 2027, toYear: 2028, preview, locale: 'en' };
    render(Page, { props: { data: data as never } });
    expect(screen.getAllByText('Buttercrunch')).toHaveLength(2);
  });
});
