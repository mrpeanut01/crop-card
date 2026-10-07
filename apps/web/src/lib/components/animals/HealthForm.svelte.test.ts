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

  it('fills the unit and lot from the picked bottle so the dose comes off stock (#648, #745)', async () => {
    render(HealthForm, {
      ...base,
      stock: [{ id: 's1', name: 'Safe-Guard', unit: 'ml', lotNumber: 'SG-2611' }]
    });
    await fireEvent.change(screen.getByLabelText(/Taken from stock/), { target: { value: 's1' } });
    await fireEvent.input(screen.getByLabelText(/Dose/), { target: { value: '5' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sent()).toMatchObject({
      stockItemId: 's1',
      dose: 5,
      doseUnit: 'mL',
      lotNumber: 'SG-2611'
    });
  });

  it('keeps a unit and lot the farmer already typed', async () => {
    render(HealthForm, {
      ...base,
      stock: [{ id: 's1', name: 'Safe-Guard', unit: 'ml', lotNumber: 'SG-2611' }]
    });
    await fireEvent.input(screen.getByLabelText(/Product/), { target: { value: 'Safe-Guard' } });
    await fireEvent.input(screen.getByLabelText(/^Unit/), { target: { value: 'fl-oz' } });
    await fireEvent.input(screen.getByLabelText(/Lot number/), { target: { value: 'OTHER' } });
    await fireEvent.change(screen.getByLabelText(/Taken from stock/), { target: { value: 's1' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sent()).toMatchObject({ doseUnit: 'fl-oz', lotNumber: 'OTHER' });
  });
});
