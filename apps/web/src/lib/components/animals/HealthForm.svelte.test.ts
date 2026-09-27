/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { localInputToMs, msToLocalInput } from '$lib/animals/display';

const { default: HealthForm } = await import('./HealthForm.svelte');

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ warnings: [] }), { status: 201 }));
  globalThis.fetch = fetchMock as never;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const base = {
  subjectType: 'animal' as const,
  subjectId: 'a1',
  foodProducing: true,
  products: [],
  stock: [],
  onDone: vi.fn()
};

function sent(): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
}

describe('HealthForm', () => {
  it('sends a planned last dose as entered, so the hold runs from it (C-03)', async () => {
    render(HealthForm, base);
    await fireEvent.input(screen.getByLabelText(/Product/), { target: { value: 'Pen G' } });
    const last = msToLocalInput(Date.now() + 4 * 86_400_000);
    await fireEvent.input(screen.getByLabelText(/Last dose/), { target: { value: last } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sent().courseEndAt).toBe(localInputToMs(last));
  });

  it('never offers a helper "As the label says"', async () => {
    render(HealthForm, { ...base, isOwner: false });
    await fireEvent.input(screen.getByLabelText(/Product/), { target: { value: 'Wormer' } });
    expect(screen.queryByText('As the label says')).toBeNull();
    expect(screen.getByText('My vet directed it')).toBeTruthy();
    expect(screen.getByText(/The owner confirms/)).toBeTruthy();
  });

  it('asks a household pet nothing about withdrawals', async () => {
    render(HealthForm, { ...base, foodProducing: false, showHolds: false });
    await fireEvent.click(screen.getByLabelText('Vaccine'));
    await fireEvent.input(screen.getByLabelText(/Product/), { target: { value: 'Rabies' } });
    expect(screen.queryByText('Used how?')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sent().labelUse).toBeUndefined();
  });
});
