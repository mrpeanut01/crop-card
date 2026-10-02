/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import DispositionPanel from './DispositionPanel.svelte';

const HOUR = 3_600_000;

function setup(occurredAt: number) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  render(DispositionPanel, {
    harvest: { id: 'h1', cropId: null, occurredAt: occurredAt - 2 * HOUR, quantity: '40 lb' },
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
        ledgerEntryId: null,
        sale: null,
        locked: false,
        createdAt: occurredAt
      }
    ],
    canWrite: true,
    isOwner: true,
    canRecordSale: false,
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
