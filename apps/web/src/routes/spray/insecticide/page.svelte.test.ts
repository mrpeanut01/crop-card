/**
 * @vitest-environment jsdom
 *
 * #130 — pollinator-protection tiles render and gate the Record button.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './+page.svelte';

const insecticide = (pluginId: string, pollinator: unknown) => ({
  pluginId,
  displayName: pluginId,
  targetPests: [],
  scoutingThresholds: [],
  applicationProtocol: [],
  reEntryIntervalHours: 12,
  preHarvestIntervalDays: 7,
  pollinatorRisk: 'high',
  pollinator,
  epaRegistrationNumber: null,
  iracGroups: ['4A']
});

function data(pollinator: unknown, bloomingCropPluginIds: string[]) {
  return {
    insecticides: [insecticide('neonic', pollinator)],
    blocks: [
      {
        id: 'b1',
        name: 'North',
        cropPluginIds: ['squash'],
        lat: 39.1157,
        lon: -77.5636,
        bloomingCropPluginIds
      }
    ],
    recentEvents: [],
    activeREI: [],
    preselectedBlockId: 'b1',
    preselectedCropId: null,
    taskId: null,
    aiEnabled: false,
    scoutLogByBlock: {}
  };
}

const recordButton = () => screen.getByRole('button', { name: /record application/i });

describe('/spray/insecticide pollinator gate (#130)', () => {
  it('renders per-check tiles instead of the stub', () => {
    render(Page, {
      props: {
        data: data({ beeToxicity: 'relatively-nontoxic', bloomRestriction: 'none' }, [])
      } as never
    });
    expect(screen.queryByText(/Full evaluator lands/)).toBeNull();
    for (const id of ['bee-toxicity', 'bloom', 'time-of-day', 'residual']) {
      expect(screen.getByTestId(`pollinator-check-${id}`)).toBeTruthy();
    }
    expect(recordButton()).not.toBeDisabled();
  });

  it('prefills in-bloom from crop bloom windows and blocks a bloom-prohibited label', async () => {
    render(Page, {
      props: {
        data: data({ beeToxicity: 'highly-toxic', bloomRestriction: 'prohibited-during-bloom' }, [
          'squash'
        ])
      } as never
    });
    const bloomTile = screen.getByTestId('pollinator-check-bloom');
    expect(bloomTile.dataset.status).toBe('block');
    expect(bloomTile.getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('pollinator-overall').textContent).toMatch(/blocked/i);
    expect(recordButton()).toBeDisabled();

    await fireEvent.click(screen.getByLabelText(/no bloom/i));
    expect(screen.getByTestId('pollinator-check-bloom').dataset.status).toBe('pass');
    expect(recordButton()).not.toBeDisabled();
  });

  it('an unanswered bloom question blocks a bloom-prohibited label', () => {
    render(Page, {
      props: {
        data: data({ beeToxicity: 'highly-toxic', bloomRestriction: 'prohibited-during-bloom' }, [])
      } as never
    });
    expect(screen.getByTestId('pollinator-check-bloom').dataset.status).toBe('block');
    expect(recordButton()).toBeDisabled();
  });

  it('shows nearby pollinator-attractive blocks as an advisory tile that never disables Record', async () => {
    const d = data(
      { beeToxicity: 'highly-toxic', bloomRestriction: 'prohibited-during-bloom' },
      []
    );
    (d.blocks[0] as Record<string, unknown>).pollinatorNeighbors = [
      {
        blockId: 'b2',
        name: 'Squash patch',
        distanceFt: 1500,
        crops: [
          { cropPluginId: 'squash', displayName: 'Squash', inBloomNow: true, beeAttractive: true }
        ]
      }
    ];
    render(Page, { props: { data: d } as never });
    await fireEvent.click(screen.getByLabelText(/no bloom/i));
    const tile = screen.getByTestId('pollinator-check-nearby-blocks');
    expect(tile.dataset.status).toBe('warn');
    expect(screen.getByTestId('nearby-block-b2').textContent).toMatch(/Squash patch/);
    expect(recordButton()).not.toBeDisabled();
  });
});
