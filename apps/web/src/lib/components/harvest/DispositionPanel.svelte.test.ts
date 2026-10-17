/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import DispositionPanel from './DispositionPanel.svelte';

const HOUR = 3_600_000;

function setup(
  occurredAt: number,
  opts: { cropId?: string | null; isOwner?: boolean; canWrite?: boolean } = {}
) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(DispositionPanel, {
    harvest: {
      id: 'h1',
      cropId: opts.cropId ?? null,
      occurredAt: occurredAt - 2 * HOUR,
      quantity: '40 lb'
    },
    dispositions: [
      {
        id: 'd1',
        harvestEventId: 'h1',
        kind: 'sold',
        quantity: 10,
        unit: 'lb',
        occurredAt,
        recipient: 'Ann',
        soldAsOrganic: null,
        preservedAs: null,
        ledgerEntryId: null,
        sale: null,
        locked: false,
        createdAt: occurredAt
      }
    ],
    canWrite: opts.canWrite ?? true,
    isOwner: opts.isOwner ?? true,
    askSoldAsOrganic: false,
    online: true,
    onChanged: () => {}
  });
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('DispositionPanel edits', () => {
  it('a change that keeps the day does not re-date the entry', async () => {
    const fetchMock = setup(Date.now() - HOUR);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await fireEvent.input(screen.getByDisplayValue('Ann'), { target: { value: 'Bea' } });
    await fireEvent.submit(screen.getByTestId('disposition-form'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/harvest/dispositions/d1');
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(String(init.body));
    expect(body.recipient).toBe('Bea');
    expect('occurredAt' in body).toBe(false);
  });
});

describe('DispositionPanel money link (#733, #718)', () => {
  it('shows the owner "Also record the money" on a Sold row, linked to the planting', () => {
    setup(Date.now() - HOUR, { cropId: 'crop-1' });
    const link = screen.getByRole('link', { name: 'Also record the money' });
    const href = new URL(link.getAttribute('href') ?? '', 'http://x');
    expect(href.pathname).toBe('/finance/new');
    expect(href.searchParams.get('cropId')).toBe('crop-1');
    expect(href.searchParams.get('dispositionId')).toBe('d1');
  });

  it('never shows it to a helper', () => {
    setup(Date.now() - HOUR, { cropId: 'crop-1', isOwner: false });
    expect(screen.queryByRole('link', { name: 'Also record the money' })).toBeNull();
  });
});

describe('DispositionPanel how it was kept (37C)', () => {
  it('asks how a kept harvest was kept and sends the method', async () => {
    const fetchMock = setup(Date.now() - HOUR);
    expect(screen.queryByTestId('preserved-as')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Kept' }));
    const group = screen.getByTestId('preserved-as');
    expect(group.getAttribute('aria-label')).toBe('How was it kept?');
    await fireEvent.click(screen.getByRole('button', { name: 'Dried' }));
    await fireEvent.input(screen.getByLabelText('How much'), { target: { value: '2' } });
    await fireEvent.input(screen.getByLabelText('Unit'), { target: { value: 'bunch' } });
    await fireEvent.submit(screen.getByTestId('disposition-form'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/harvest/h1/dispositions');
    const body = JSON.parse(String(init.body));
    expect(body.kind).toBe('kept');
    expect(body.preservedAs).toBe('dry');
  });

  it('never sends a method for a sale', async () => {
    const fetchMock = setup(Date.now() - HOUR);
    await fireEvent.click(screen.getByRole('button', { name: 'Kept' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Frozen' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Sold' }));
    expect(screen.queryByTestId('preserved-as')).toBeNull();
    await fireEvent.input(screen.getByLabelText('How much'), { target: { value: '2' } });
    await fireEvent.submit(screen.getByTestId('disposition-form'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).preservedAs).toBeNull();
  });
});
