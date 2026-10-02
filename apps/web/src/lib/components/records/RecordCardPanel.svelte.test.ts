/**
 * @vitest-environment jsdom
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import RecordCardPanel from './RecordCardPanel.svelte';
import { buildScoutRecordCard } from '$lib/cards/build/record';
import { clearCardCaches } from '$lib/client/cardStore';
import {
  isRecordCardPinned,
  openRecordCard,
  pinRecordCard,
  saveRecordCard
} from '$lib/client/recordCardStore';
import { db } from '$lib/client/dexie';

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

  it('offers the owner void on a fresh application and hides it from a helper (32G G4)', async () => {
    const r = render(RecordCardPanel, {
      recordKind: 'fungicide',
      rowId: 'fu-1',
      prefs,
      onPrint: vi.fn(),
      fetcher: respond(200, {
        cards: [card],
        origin: null,
        voidableUntilMs: Date.now() + 3_600_000,
        canVoidHolds: true
      })
    });
    expect(await screen.findByRole('button', { name: 'Void this entry…' })).toBeInTheDocument();
    r.unmount();
    render(RecordCardPanel, {
      recordKind: 'fungicide',
      rowId: 'fu-1',
      prefs,
      onPrint: vi.fn(),
      fetcher: respond(200, {
        cards: [card],
        origin: null,
        voidableUntilMs: Date.now() + 3_600_000,
        canVoidHolds: false
      })
    });
    await screen.findByRole('button', { name: 'Print card' });
    expect(screen.queryByRole('button', { name: 'Void this entry…' })).toBeNull();
  });

  it('never offers a void on a kind with no void route', async () => {
    render(RecordCardPanel, {
      recordKind: 'scout',
      rowId: 'sc-1',
      prefs,
      onPrint: vi.fn(),
      fetcher: respond(200, {
        cards: [card],
        origin: null,
        voidableUntilMs: Date.now() + 3_600_000,
        canVoidHolds: true
      })
    });
    await screen.findByRole('button', { name: 'Print card' });
    expect(screen.queryByRole('button', { name: 'Void this entry…' })).toBeNull();
  });

  describe('saved on this device (33D D1)', () => {
    beforeEach(async () => {
      await clearCardCaches();
      sessionStorage.clear();
      sessionStorage.setItem('cropcard.activeOwnerId', 'owner_a');
    });

    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    it('stores the card on open without its void rights, and pins it', async () => {
      render(RecordCardPanel, {
        recordKind: 'scout',
        rowId: 'sc-1',
        prefs,
        onPrint: vi.fn(),
        fetcher: respond(200, {
          cards: [card],
          origin: 'https://app.cropcard.io',
          voidableUntilMs: 9,
          canVoidHolds: true
        })
      });
      const pin = await screen.findByRole('button', { name: 'Pin on this device' });
      const row = await db().recordCards.get(['owner_a', 'rc_scout.sc-1']);
      expect(row?.model).toEqual({
        v: 1,
        recordKind: 'scout',
        rowId: 'sc-1',
        cards: [card],
        origin: 'https://app.cropcard.io'
      });
      await fireEvent.click(pin);
      expect(await screen.findByRole('button', { name: 'Pinned on this device' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(await isRecordCardPinned('rc_scout.sc-1')).toBe(true);
    });

    it('shows the saved copy with its notice when there is no signal', async () => {
      await saveRecordCard(
        { v: 1, recordKind: 'fungicide', rowId: 'fu-1', cards: [card], origin: null },
        Date.parse('2026-06-01T14:00:00Z')
      );
      render(RecordCardPanel, {
        recordKind: 'fungicide',
        rowId: 'fu-1',
        prefs,
        onPrint: vi.fn(),
        fetcher: offline
      });
      const note = await screen.findByTestId('saved-copy-notice');
      expect(note).toHaveAttribute('role', 'note');
      expect(note.textContent).toMatch(
        /^\s*Saved copy from Jun 1, 2026.*\. The record may have changed since\.\s*$/
      );
      expect(screen.getByRole('heading', { name: 'Hornworm' })).toBeInTheDocument();
      expect(screen.queryByText('Editable')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Void this entry…' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Print card' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Pin on this device' })).toBeInTheDocument();
    });

    it('says the deck is the fallback when nothing is saved', async () => {
      render(RecordCardPanel, {
        recordKind: 'spray',
        rowId: 's9',
        prefs,
        onPrint: vi.fn(),
        fetcher: offline
      });
      await waitFor(() => expect(screen.getByText(/No connection/)).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /Pin/ })).toBeNull();
    });

    it('forgets the saved copy and its pin when the record is gone', async () => {
      await saveRecordCard({
        v: 1,
        recordKind: 'spray',
        rowId: 'gone',
        cards: [card],
        origin: null
      });
      await pinRecordCard('rc_spray.gone');
      render(RecordCardPanel, {
        recordKind: 'spray',
        rowId: 'gone',
        prefs,
        onPrint: vi.fn(),
        fetcher: respond(404, {})
      });
      await screen.findByText('This record is no longer here.', { exact: false });
      await waitFor(async () => expect(await db().recordCards.count()).toBe(0));
      expect(await db().pinnedCards.count()).toBe(0);
    });

    it('forgets the saved copy after a void', async () => {
      const responses = [
        new Response(
          JSON.stringify({
            cards: [card],
            origin: null,
            voidableUntilMs: Date.now() + 3_600_000,
            canVoidHolds: true
          }),
          { status: 200 }
        ),
        new Response(JSON.stringify({ voided: 'fu-2', kind: 'fungicide' }), { status: 200 })
      ];
      const fetcher = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;
      render(RecordCardPanel, {
        recordKind: 'fungicide',
        rowId: 'fu-2',
        prefs,
        onPrint: vi.fn(),
        fetcher
      });
      await screen.findByRole('button', { name: 'Pin on this device' });
      expect(await openRecordCard('rc_fungicide.fu-2')).not.toBeNull();
      await fireEvent.click(screen.getByRole('button', { name: 'Void this entry…' }));
      await fireEvent.input(screen.getByLabelText('Why is this entry being voided?'), {
        target: { value: 'Wrong block' }
      });
      await fireEvent.click(screen.getByRole('button', { name: 'Void this entry' }));
      await screen.findByText(/Voided\./);
      await waitFor(async () => expect(await db().recordCards.count()).toBe(0));
    });
  });
});
