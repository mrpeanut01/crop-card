/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import SeasonTimelineCard from './SeasonTimelineCard.svelte';
import type { PlantingRecord } from '$lib/db/blocks';

const planting = {
  id: 'p1',
  cropPluginId: 'garlic',
  varietyDisplayName: 'Music',
  plantingDate: Date.UTC(2027, 4, 1)
} as unknown as PlantingRecord;

describe('SeasonTimelineCard axis', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 5, 15)));
  });
  afterEach(() => vi.useRealTimers());

  it("draws the plan's season year, not the current calendar year", () => {
    const { container } = render(SeasonTimelineCard, {
      props: {
        plantings: [planting],
        events: [],
        daysToMaturityById: { garlic: 60 },
        seasonYear: 2027
      }
    });
    expect(container.textContent).toContain('2027');
    const bar = container.querySelector<HTMLElement>('.window');
    const left = parseFloat(bar?.style.left ?? '');
    expect(left).toBeGreaterThan(10);
    expect(left).toBeLessThan(20);
    expect(container.querySelector('.today-pin')).toBeNull();
  });

  it('shows the today pin inside the season year', () => {
    const { container } = render(SeasonTimelineCard, {
      props: { plantings: [planting], events: [], seasonYear: 2026 }
    });
    expect(container.querySelector('.today-pin')).not.toBeNull();
  });
});
