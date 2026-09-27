/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

const enqueueRecord = vi.fn(async () => 'q1');
vi.mock('$lib/client/syncQueue', () => ({ enqueueRecord, scheduleDrain: vi.fn() }));

const { default: MoveForm } = await import('./MoveForm.svelte');

const areas = [
  { id: 'coop', name: 'Hen house', kind: 'barn' },
  { id: 'pen', name: 'Broody pen', kind: 'barn' }
];

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  enqueueRecord.mockClear();
  fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          move: {
            fieldId: 'pen',
            newGroup: { id: 'g2', name: 'Broody hens' },
            capacity: { capacity: 4, count: 6, over: true }
          }
        }),
        { status: 201 }
      )
  );
  globalThis.fetch = fetchMock as never;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('MoveForm', () => {
  it('moves part of a flock by count and picked names', async () => {
    const onDone = vi.fn();
    render(MoveForm, {
      subjectType: 'group',
      subjectId: 'g1',
      areas,
      currentFieldId: 'coop',
      group: {
        headCount: 20,
        total: 24,
        noun: 'flock',
        members: [{ id: 'a1', label: 'Henny' }]
      },
      onDone
    });
    const to = screen.getByLabelText('Move to') as HTMLSelectElement;
    expect(Array.from(to.options).map((o) => o.value)).toEqual(['', 'pen']);
    await fireEvent.change(to, { target: { value: 'pen' } });
    await fireEvent.click(screen.getByLabelText('Some of them'));
    await fireEvent.input(screen.getByLabelText(/How many unnamed/), { target: { value: '4' } });
    await fireEvent.click(screen.getByLabelText('Henny'));
    await fireEvent.click(screen.getByRole('button', { name: 'Save the move' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({
      subjectType: 'group',
      subjectId: 'g1',
      fieldId: 'pen',
      count: 4,
      animalIds: ['a1']
    });
    expect(onDone.mock.calls[0][1]).toMatch(/Over capacity \(6 of 4\)/);
  });

  it('refuses more unnamed than the flock has', async () => {
    render(MoveForm, {
      subjectType: 'group',
      subjectId: 'g1',
      areas,
      currentFieldId: 'coop',
      group: { headCount: 3, total: 3, noun: 'flock', members: [] },
      onDone: vi.fn()
    });
    await fireEvent.change(screen.getByLabelText('Move to'), { target: { value: 'pen' } });
    await fireEvent.click(screen.getByLabelText('Some of them'));
    await fireEvent.input(screen.getByLabelText(/How many unnamed/), { target: { value: '5' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save the move' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Only 3 unnamed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the move on the phone with no signal', async () => {
    const onDone = vi.fn();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      render(MoveForm, {
        subjectType: 'animal',
        subjectId: 'a1',
        areas,
        currentFieldId: null,
        onDone
      });
      await fireEvent.change(screen.getByLabelText('Move to'), { target: { value: 'coop' } });
      await fireEvent.click(screen.getByRole('button', { name: 'Save the move' }));
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(onDone.mock.calls[0][0]).toEqual({ status: 'queued' });
      expect(enqueueRecord).toHaveBeenCalledWith(
        'animal-move',
        expect.objectContaining({ subjectType: 'animal', subjectId: 'a1', fieldId: 'coop' }),
        expect.any(String)
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      online.mockRestore();
    }
  });
});
