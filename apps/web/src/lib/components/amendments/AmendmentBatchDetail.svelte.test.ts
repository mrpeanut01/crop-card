/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn() }));

import AmendmentBatchDetail from './AmendmentBatchDetail.svelte';
import type { AmendmentDetailPayload } from '$lib/server/amendmentDetail';

const T = Date.UTC(2026, 8, 1, 12);

function props(over: Partial<AmendmentDetailPayload> = {}): Omit<AmendmentDetailPayload, 'type'> {
  return {
    batch: {
      id: 'b1',
      kind: 'manure',
      name: 'Goat pile',
      origin: 'on-farm',
      supplier: null,
      supplierStatement: null,
      startedAt: T,
      closedAt: null,
      notes: null,
      createdBy: null,
      createdAt: T,
      state: 'may-carry',
      stateLabel: 'May carry a weed killer',
      paths: [
        {
          state: 'may-carry',
          inputId: 'i1',
          sentence:
            'Goats grazed North pasture from Aug 1, 2026 to now, after GrazonNext HL was sprayed there on Jul 20, 2026.'
        }
      ],
      morePaths: 2,
      standingNotes: [
        'Bought hay and feed are not traced. If your animals ate bought hay, ask where it grew.'
      ],
      advice: null,
      inputs: [
        {
          id: 'i1',
          batchId: 'b1',
          inputType: 'group',
          inputId: 'g1',
          fromAt: T,
          toAt: null,
          supplierStatement: null,
          createdBy: null,
          createdAt: T,
          label: 'Goats'
        }
      ],
      provenance: 'data'
    },
    bioassays: [],
    spreads: [],
    options: { animals: [], groups: [{ id: 'g1', label: 'Goats' }], batches: [], lots: [] },
    canEdit: true,
    canDeleteInputs: false,
    today: '2026-09-02',
    ...over
  };
}

describe('AmendmentBatchDetail', () => {
  it('shows the state, the path and the standing note, and never says safe', () => {
    const { container } = render(AmendmentBatchDetail, props());
    expect(screen.getByTestId('carryover-label')).toHaveTextContent('May carry a weed killer');
    expect(screen.getByTestId('carryover-paths')).toHaveTextContent('Goats grazed North pasture');
    expect(screen.getByText('And 2 more.')).toBeInTheDocument();
    expect(screen.getByText(/Bought hay and feed are not traced/)).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/\bsafe\b|\bclear\b/i);
  });

  it('hides Remove from helpers and shows it to the owner', () => {
    render(AmendmentBatchDetail, props());
    expect(screen.queryByRole('button', { name: /Remove Goats/ })).toBeNull();
    expect(screen.getByTestId('add-input-form')).toBeInTheDocument();
  });

  it('lets the owner remove an input; a read-only viewer gets no forms', () => {
    const { unmount } = render(AmendmentBatchDetail, props({ canDeleteInputs: true }));
    expect(screen.getByRole('button', { name: /Remove Goats/ })).toBeInTheDocument();
    unmount();
    render(AmendmentBatchDetail, props({ canEdit: false }));
    expect(screen.queryByTestId('add-input-form')).toBeNull();
    expect(screen.queryByRole('button', { name: /Save details/ })).toBeNull();
  });

  it('a bought load shows the supplier advice and no inputs section', () => {
    const p = props();
    render(AmendmentBatchDetail, {
      ...p,
      batch: {
        ...p.batch,
        origin: 'bought',
        supplier: 'Neighbour',
        state: 'not-known',
        stateLabel: 'Not known',
        paths: [],
        morePaths: 0,
        standingNotes: [],
        inputs: [],
        advice:
          'Ask the supplier which weed killers were used on the hay or pasture, or run a pea or bean test.'
      }
    });
    expect(screen.getByTestId('carryover-advice')).toHaveTextContent('Ask the supplier');
    expect(screen.queryByTestId('add-input-form')).toBeNull();
    expect(screen.getByTestId('supplier-statement')).toBeInTheDocument();
  });

  it('lets the owner remove a pea or bean test recorded on the batch', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as never;
    try {
      const bioassays = [
        { id: 't1', testedAt: T, result: 'no-damage', note: null, blockId: null, blockName: null }
      ] as unknown as AmendmentDetailPayload['bioassays'];
      const { unmount } = render(AmendmentBatchDetail, props({ bioassays }));
      expect(screen.queryByRole('button', { name: 'Remove this test' })).toBeNull();
      unmount();
      render(AmendmentBatchDetail, props({ bioassays, canDeleteInputs: true }));
      await fireEvent.click(screen.getByRole('button', { name: 'Remove this test' }));
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toEqual({ url: '/api/amendments/bioassays/t1', method: 'DELETE' });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('keeps unsaved Details edits when the page reloads its data', async () => {
    const p = props();
    const { container, rerender } = render(AmendmentBatchDetail, p);
    const notes = container.querySelector('textarea') as HTMLTextAreaElement;
    await fireEvent.input(notes, { target: { value: 'typed notes not yet saved' } });
    await rerender({ ...p, batch: { ...p.batch } });
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      'typed notes not yet saved'
    );
    await rerender({ ...p, batch: { ...p.batch, notes: 'Saved elsewhere' } });
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe(
      'Saved elsewhere'
    );
  });
});
