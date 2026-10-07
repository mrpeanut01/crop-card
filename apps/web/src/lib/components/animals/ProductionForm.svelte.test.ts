/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const { default: ProductionForm } = await import('./ProductionForm.svelte');

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  }
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ warnings: [] }), { status: 201 }));
  globalThis.fetch = fetchMock as never;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const base = {
  subjectType: 'animal' as const,
  subjectId: 'a1',
  defaultKind: 'milk' as const,
  isOwner: true,
  onStopped: vi.fn(),
  onDone: vi.fn()
};

function sentAt(i: number): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[i] as [string, RequestInit])[1].body as string);
}

describe('ProductionForm', () => {
  it('offers only the foods the subject gives, and weight (#650)', () => {
    render(ProductionForm, { ...base, defaultKind: 'eggs', foods: ['eggs', 'meat'] });
    expect(screen.getByLabelText('Eggs')).toBeTruthy();
    expect(screen.queryByLabelText('Milk')).toBeNull();
    expect(screen.getByLabelText('Weight')).toBeTruthy();
  });

  it('starts on a kind the subject gives', () => {
    render(ProductionForm, { ...base, defaultKind: 'milk', foods: ['meat'] });
    expect((screen.getByLabelText('Weight') as HTMLInputElement).checked).toBe(true);
  });

  it('offers Save as discarded when a treatment on file comes after the date (#714)', async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            error: 'Safe-Guard is on record for Luna on Oct 7, after the date entered.',
            code: 'OUT_OF_ORDER',
            resubmitAs: 'discard'
          }),
          { status: 409 }
        )
    );
    render(ProductionForm, { ...base, foods: ['milk', 'meat'] });
    await fireEvent.input(screen.getByRole('spinbutton'), { target: { value: '1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const discard = await screen.findByRole('button', { name: 'Save as discarded' });
    expect(screen.getByText(/Safe-Guard is on record/)).toBeTruthy();
    expect(sentAt(0).use).toBe('food');
    await fireEvent.click(discard);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sentAt(1)).toMatchObject({ use: 'discard', occurredAt: sentAt(0).occurredAt });
  });
});
