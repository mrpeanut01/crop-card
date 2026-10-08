/**
 * @vitest-environment jsdom
 *
 * #530 — fungicide products show their label pollinator block, and a
 * bee-toxic pick on a blooming block shows the bloom notice.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));

import Page from './+page.svelte';

const fungicide = (pluginId: string, pollinatorRisk: string, pollinator: unknown) => ({
  pluginId,
  displayName: pluginId,
  applicationTiming: null,
  targetDiseases: [],
  fracCodes: ['NC'],
  reEntryIntervalHours: 1,
  preHarvestIntervalDays: 0,
  rainfastHours: null,
  pollinatorRisk,
  pollinator,
  ratePerAcre: { amount: 1, unit: 'qt' },
  gpaCalibration: 50,
  deconRequired: false,
  complianceFlags: {},
  epaRegistrationNumber: null
});

function data(bloomingCropPluginIds: string[], productPluginIds: string[]) {
  return {
    fungicides: [
      fungicide('peroxide', 'low', {
        beeToxicity: 'highly-toxic',
        bloomRestriction: 'dusk-to-dawn-only'
      }),
      fungicide('quiet', 'low', { beeToxicity: 'unknown', bloomRestriction: 'none' })
    ],
    pasture: { areas: [], blockArea: {}, animalsByArea: {} },
    organicBlocks: {},
    priorFungicideByBlock: {},
    blocks: [
      { id: 'b1', name: 'North', acres: 1, cropPluginIds: ['squash'], bloomingCropPluginIds }
    ],
    sprayers: [],
    recentEvents: [],
    activeREI: [],
    preselect: { blockId: 'b1', cropId: null, taskId: null, productPluginIds },
    aiEnabled: false,
    setup: { canEdit: true, areas: [] },
    taskContext: null
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({}), { status: 503 }))
  );
});

describe('/spray/fungicide pollinator label data (#530)', () => {
  it('lists each product with its label pollinator block', () => {
    render(Page, { props: { data: data([], []) } as never });
    expect(screen.getByText(/Bees: highly-toxic · dusk-to-dawn-only/)).toBeTruthy();
    expect(screen.getByText(/Bees: unknown/)).toBeTruthy();
  });

  it('shows the bloom notice for a bee-toxic label on a blooming block', () => {
    render(Page, { props: { data: data(['squash'], ['peroxide']) } as never });
    const notice = screen.getByTestId('fungicide-bloom-notice');
    expect(notice.textContent).toMatch(/peroxide/);
    expect(notice.textContent).toMatch(/squash/);
    expect(notice.getAttribute('data-english-only')).toBe('safety');
  });

  it('names the crop and block instead of ids, and sizes the block (#673 #675)', () => {
    const d = {
      ...data(['squash'], ['peroxide']),
      cropNames: { squash: 'Butternut Squash' },
      blocks: [
        {
          id: 'f6034532-uuid',
          name: 'Apple Row',
          acres: 0.13,
          cropPluginIds: ['squash'],
          bloomingCropPluginIds: ['squash']
        }
      ],
      preselect: { blockId: 'f6034532-uuid', cropId: null, taskId: null, productPluginIds: [] },
      recentEvents: [
        {
          id: 'e1',
          blockId: 'f6034532-uuid',
          occurredAt: Date.now(),
          products: [{ pluginId: 'quiet', displayName: 'quiet' }],
          preHarvestClearAt: null
        }
      ]
    };
    const { container } = render(Page, { props: { data: d } as never });
    const text = container.textContent ?? '';
    expect(text).toContain('Butternut Squash');
    expect(text).toContain('Apple Row · 0.13 ac');
    expect(text).toMatch(/Target diseases/i);
    expect(text).not.toMatch(/Target weeds/i);
    expect(text).not.toContain('f6034532');
    expect(text).not.toMatch(/Phase 26/);
  });

  it('no notice for a bee-silent label with a low hint, or out of bloom', () => {
    const a = render(Page, { props: { data: data(['squash'], ['quiet']) } as never });
    expect(screen.queryByTestId('fungicide-bloom-notice')).toBeNull();
    a.unmount();
    render(Page, { props: { data: data([], ['peroxide']) } as never });
    expect(screen.queryByTestId('fungicide-bloom-notice')).toBeNull();
  });
});
