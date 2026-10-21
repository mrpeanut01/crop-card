/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import HarvestSchedulePanel from './HarvestSchedulePanel.svelte';
import type { HarvestScheduleResponse } from '$lib/garden/harvestScheduleApi';

const schedule: HarvestScheduleResponse = {
  year: 2026,
  weeks: [
    {
      week: '2026-06-29',
      cuts: [
        {
          plantingId: 'p1',
          cropPluginId: 'basil-genovese',
          cropName: 'Basil',
          blockName: 'Bed 1',
          kind: 'window',
          fromMs: Date.UTC(2026, 6, 1),
          toMs: Date.UTC(2026, 6, 21),
          provenance: 'plugin'
        }
      ]
    }
  ],
  plantings: [
    {
      plantingId: 'p1',
      cropPluginId: 'basil-genovese',
      cropName: 'Basil',
      blockName: 'Bed 1',
      endsAt: 'first-fall-frost',
      firstWindowOnly: true,
      cutCount: 1,
      nextCut: null,
      preserving: [],
      timing: []
    }
  ],
  goals: [
    {
      goal: 'dry',
      target: null,
      method: 'dry',
      status: 'not-known',
      reason: 'no-data',
      provenance: 'fallback'
    }
  ]
};

afterEach(() => vi.unstubAllGlobals());

describe('HarvestSchedulePanel', () => {
  it('lists the weeks, the first-harvest-only note and the goal lines, with no amounts', () => {
    render(HarvestSchedulePanel, { schedule });
    expect(screen.getByRole('heading', { name: 'What you will harvest' })).toBeTruthy();
    expect(screen.getAllByTestId('harvest-week')).toHaveLength(1);
    expect(screen.getByText('First harvest')).toBeTruthy();
    expect(screen.getByText(/First harvest only/)).toBeTruthy();
    expect(screen.getByText(/no amounts are shown/)).toBeTruthy();
    const goal = screen.getByTestId('goal-line');
    expect(goal.dataset.status).toBe('not-known');
    expect(goal.textContent).toContain('Drying: Not known.');
  });

  it('shows the sourced cutting stage per planting, and hides it when asked (#867)', () => {
    const withTiming: HarvestScheduleResponse = {
      ...schedule,
      plantings: [
        { ...schedule.plantings[0], timing: [{ method: 'dry', stage: 'before-bloom' }] },
        {
          ...schedule.plantings[0],
          plantingId: 'p2',
          cropPluginId: 'oregano-greek',
          cropName: 'Oregano'
        }
      ]
    };
    const { unmount } = render(HarvestSchedulePanel, { schedule: withTiming });
    const lines = screen.getAllByTestId('harvest-timing');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toContain('For drying');
    expect(lines[0].textContent).toContain('Cut just before it flowers.');
    expect(lines[0].dataset.stage).toBe('before-bloom');
    unmount();
    render(HarvestSchedulePanel, { schedule: withTiming, showTiming: false });
    expect(screen.queryByTestId('harvest-timing')).toBeNull();
  });

  it('hides goals when asked and fetches its own schedule for an Area', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ...schedule, weeks: [] }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(HarvestSchedulePanel, { areaId: 'area 1', showGoals: false });
    await waitFor(() => expect(screen.getByTestId('harvest-schedule-empty')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/garden/harvest-schedule?areaId=area%201');
    expect(screen.queryByTestId('goal-line')).toBeNull();
  });

  it('says it needs a connection when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      })
    );
    render(HarvestSchedulePanel, {});
    await waitFor(() =>
      expect(screen.getByText('The harvest plan needs a connection.')).toBeTruthy()
    );
  });
});
