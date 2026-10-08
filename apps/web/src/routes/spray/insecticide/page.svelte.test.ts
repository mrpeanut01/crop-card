/**
 * @vitest-environment jsdom
 *
 * #130 — pollinator-protection tiles render and gate the Record button.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const nav = vi.hoisted(() => ({ invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: nav.invalidateAll }));
vi.mock('$lib/animals/recordClient', () => ({ noteHoldWrite: vi.fn(async () => {}) }));

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
    sprayers: [{ id: 's1', label: 'Boom', calibratedGpa: 20 }],
    setup: { canEdit: true, areas: [], sprayerTemplates: [] },
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

describe('/spray/insecticide IPM gate mirrors the kernel', () => {
  const threshold = { pest: 'aphid', metric: 'count-per-plant', threshold: 5 };
  function ipmData(log: Array<{ value: number; occurredAt: number }>) {
    const d = data({ beeToxicity: 'relatively-nontoxic', bloomRestriction: 'none' }, []);
    d.insecticides[0].scoutingThresholds = [threshold] as never[];
    (d as Record<string, unknown>).scoutLogByBlock = {
      b1: log.map((o) => ({ pest: 'aphid', metric: 'count-per-plant', ...o }))
    };
    return d;
  }

  it('a latest count equal to the threshold clears the gate', () => {
    render(Page, {
      props: { data: ipmData([{ value: 5, occurredAt: Date.now() - 1000 }]) } as never
    });
    expect(recordButton()).not.toBeDisabled();
  });

  it('an observation typed on the page clears the gate', async () => {
    render(Page, { props: { data: ipmData([]) } as never });
    expect(recordButton()).toBeDisabled();
    await fireEvent.input(document.getElementById('scout-pest')!, { target: { value: 'aphid' } });
    await fireEvent.input(document.getElementById('scout-value')!, { target: { value: '7' } });
    expect(recordButton()).not.toBeDisabled();
  });

  it('a lower latest count still blocks', () => {
    const now = Date.now();
    render(Page, {
      props: {
        data: ipmData([
          { value: 9, occurredAt: now - 3 * 86_400_000 },
          { value: 2, occurredAt: now - 1000 }
        ])
      } as never
    });
    expect(recordButton()).toBeDisabled();
  });
});

describe('/spray/insecticide sprayer picker (#736)', () => {
  const quiet = { beeToxicity: 'relatively-nontoxic', bloomRestriction: 'none' };
  it('with two sprayers, Record waits until one is picked', async () => {
    const d = {
      ...data(quiet, []),
      sprayers: [
        { id: 's1', label: 'Boom', calibratedGpa: 20, lastChemistryClass: 'synthetic-auxin' },
        { id: 's2', label: 'Backpack', calibratedGpa: null }
      ]
    };
    render(Page, { props: { data: d } as never });
    expect(recordButton()).toBeDisabled();
    const boom = document.querySelector('[data-sprayer-id="s1"]') as HTMLElement;
    expect(boom.textContent).toMatch(/Synthetic auxin \(HRAC 4\)/);
    await fireEvent.click(boom);
    expect(boom.getAttribute('aria-pressed')).toBe('true');
    expect(recordButton()).not.toBeDisabled();
  });

  it('with no sprayer on the farm, Record stays off and offers to add one', () => {
    render(Page, { props: { data: { ...data(quiet, []), sprayers: [] } } as never });
    expect(recordButton()).toBeDisabled();
    expect(screen.getByTestId('sprayer-empty')).toBeTruthy();
  });
});

describe('/spray/insecticide provenance (#644)', () => {
  it('shows no ai badge and pre-selects nothing when there is a choice, even with AI on', () => {
    const d = data({ beeToxicity: 'relatively-nontoxic', bloomRestriction: 'none' }, []);
    d.insecticides = [
      insecticide('acramite', { beeToxicity: 'relatively-nontoxic', bloomRestriction: 'none' }),
      insecticide('neonic', { beeToxicity: 'relatively-nontoxic', bloomRestriction: 'none' })
    ];
    d.aiEnabled = true;
    const { container } = render(Page, { props: { data: d } as never });
    expect(container.querySelector('[data-provenance="ai"]')).toBeNull();
    expect(container.querySelector('[data-provenance="fallback"]')).not.toBeNull();
    expect((container.querySelector('#insecticide-product') as HTMLSelectElement).value).toBe('');
    expect(recordButton()).toBeDisabled();
  });
});

describe('/spray/insecticide after saving (#673)', () => {
  it('refreshes the page data so Recent applications shows the new record', async () => {
    nav.invalidateAll.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ event: { reEntryClearAt: Date.now() } }), { status: 200 })
      )
    );
    try {
      render(Page, {
        props: {
          data: data({ beeToxicity: 'relatively-nontoxic', bloomRestriction: 'none' }, [])
        } as never
      });
      await fireEvent.click(recordButton());
      await waitFor(() => expect(nav.invalidateAll).toHaveBeenCalled());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('names the block in Recent applications, never its id', () => {
    const d = {
      ...data({ beeToxicity: 'relatively-nontoxic', bloomRestriction: 'none' }, []),
      recentEvents: [
        {
          id: 'e1',
          blockId: 'b1',
          occurredAt: Date.now(),
          products: [{ pluginId: 'neonic', displayName: 'neonic' }],
          scoutObservation: null
        }
      ]
    };
    const { container } = render(Page, { props: { data: d } as never });
    expect(container.textContent).toMatch(/neonic\s+on North/);
  });
});
