/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import RecordCardPanel from './RecordCardPanel.svelte';
import { buildScoutRecordCard } from '$lib/cards/build/record';

const prefs = { timeZone: 'America/New_York', units: 'us' as const };
const card = buildScoutRecordCard(
  {
    rowId: 'sc-1',
    occurredAt: Date.parse('2026-06-02T12:00:00Z'),
    blockLabel: 'Bed 3',
    plantingLabel: null,
    pest: 'Hornworm',
    metric: 'per_plant',
    value: 2,
    notes: null,
    performerLabel: null,
    locked: false
  },
  { prefs, now: Date.parse('2026-06-02T12:00:00Z') }
);

function respond(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status })
  ) as unknown as typeof fetch;
}

describe('RecordCardPanel', () => {
  it('loads the record card and prints it with the chosen paper', async () => {
    const fetcher = respond(200, { cards: [card], origin: 'https://app.cropcard.io' });
    const onPrint = vi.fn();
    render(RecordCardPanel, { recordKind: 'scout', rowId: 'sc-1', prefs, onPrint, fetcher });
    expect(fetcher).toHaveBeenCalledWith('/api/records/scout/sc-1/card', expect.anything());
    const heading = await screen.findByRole('heading', { name: 'Hornworm' });
    expect(heading.closest('article')?.dataset.cardKind).toBe('scout');
    expect(screen.getByRole('link', { name: 'Open full record' })).toHaveAttribute(
      'href',
      '/records/scout/sc-1'
    );
    await fireEvent.change(screen.getByLabelText('Paper'), { target: { value: 'letter-4up' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Print card' }));
    expect(onPrint).toHaveBeenCalledWith({
      cards: [card],
      layout: 'letter-4up',
      origin: 'https://app.cropcard.io'
    });
  });

  it('says so when a record has no card', async () => {
    render(RecordCardPanel, {
      recordKind: 'fertility',
      rowId: 'f1',
      prefs,
      onPrint: vi.fn(),
      fetcher: respond(200, { cards: [], origin: null })
    });
    expect(await screen.findByText(/no card of its own/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Print card' })).toBeNull();
  });

  it('points to the saved deck when there is no connection', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    render(RecordCardPanel, { recordKind: 'spray', rowId: 's1', prefs, onPrint: vi.fn(), fetcher });
    await waitFor(() => expect(screen.getByText(/No connection/)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Open your card deck' })).toHaveAttribute(
      'href',
      '/cards'
    );
  });

  it('reports a missing record plainly', async () => {
    render(RecordCardPanel, {
      recordKind: 'spray',
      rowId: 'gone',
      prefs,
      onPrint: vi.fn(),
      fetcher: respond(404, { message: 'No such record' })
    });
    expect(
      await screen.findByText('This record is no longer here.', { exact: false })
    ).toBeInTheDocument();
  });
});
