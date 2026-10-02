/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { buildForageAdvisory } from '$lib/forage/advisory';
import ForageAdvisoryCallout from '$lib/components/animals/ForageAdvisoryCallout.svelte';
import HayForageSection from './HayForageSection.svelte';

const NOW = Date.UTC(2026, 9, 1, 16);
const advisory = buildForageAdvisory({
  target: { kind: 'area', fieldId: 'f1' },
  blocks: [{ id: 'b1', name: 'North strip' }],
  plantings: [{ blockId: 'b1', cropPluginId: 'sudan', plantingDate: NOW - 9e9 }],
  cuts: [],
  nitrogen: [],
  tests: [],
  frost: { seen: [], unknown: true },
  hazardsFor: () => ({
    name: 'Sudangrass',
    hazards: [{ kind: 'prussic-acid', triggers: ['frost', 'young-regrowth'] }]
  }),
  timeZone: 'America/New_York',
  now: NOW
});

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ForageAdvisoryCallout (move sheet)', () => {
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ advisory }), { status: 200 }));
    globalThis.fetch = fetchMock as never;
  });

  it('fetches the destination advisory and shows it folded, with no way to dismiss it', async () => {
    const { container } = render(ForageAdvisoryCallout, { fieldId: 'f1', where: 'Back pasture' });
    await screen.findByText('At Back pasture: Forage check: prussic acid');
    expect(fetchMock).toHaveBeenCalledWith('/api/forage/advisory?fieldId=f1');
    expect(container.querySelector('details')?.open).toBe(false);
    expect(screen.getByText('Frost data could not be read. Check whether it froze.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Record a forage test' }).getAttribute('href')).toBe(
      '/forage?fieldId=f1'
    );
    expect(screen.queryByRole('button', { name: /dismiss|hide|close/i })).toBeNull();
  });

  it('says the check failed rather than going quiet', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }));
    render(ForageAdvisoryCallout, { fieldId: 'f1' });
    await screen.findByText('Could not load the forage check.');
  });

  it('shows nothing when no forage hazard applies', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            advisory: { items: [], provenance: 'plugin', recordHref: '/forage', targetTest: null }
          })
        )
    );
    const { container } = render(ForageAdvisoryCallout, { fieldId: 'f1' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="forage-advisory"]')).toBeNull();
  });
});

describe('HayForageSection', () => {
  it('records a test and then shows the owner-entered lab rating', async () => {
    let saved = false;
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        saved = true;
        expect(JSON.parse(String(init.body))).toMatchObject({
          hayCuttingId: 'c1',
          labRating: { nitrate: 'Moderate' }
        });
        return new Response(JSON.stringify({ test: { id: 't1' } }), { status: 201 });
      }
      expect(url).toBe('/api/forage/advisory?hayCuttingId=c1');
      return new Response(
        JSON.stringify({
          advisory: {
            items: [],
            provenance: 'plugin',
            recordHref: '/forage?hayCuttingId=c1',
            targetTest: saved
              ? {
                  id: 't1',
                  sampledAt: NOW,
                  ratingText: 'Lab rating (owner-entered): nitrate Moderate',
                  valueText: 'Sampled Oct 1, 2026.',
                  convertedText: null
                }
              : null
          }
        })
      );
    });
    globalThis.fetch = fetchMock as never;
    render(HayForageSection, { cuttingId: 'c1', canRecord: true, canAttach: false });
    await fireEvent.click(await screen.findByRole('button', { name: 'Record a forage test' }));
    await fireEvent.input(screen.getByLabelText(/Lab rating for nitrate/), {
      target: { value: 'Moderate' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save forage test' }));
    await screen.findByText('Lab rating (owner-entered): nitrate Moderate');
    expect(screen.getByText('Forage test saved.')).toBeTruthy();
  });

  it('offers no form to an inspector', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            advisory: { items: [], provenance: 'plugin', recordHref: '', targetTest: null }
          })
        )
    ) as never;
    render(HayForageSection, { cuttingId: 'c1', canRecord: false, canAttach: false });
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Record a forage test' })).toBeNull();
  });
});
