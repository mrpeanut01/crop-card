/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import SetupAnimalHousing from './SetupAnimalHousing.svelte';

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ field: { id: 'f9', name: 'Hen house' } }), { status: 201 })
  );
  globalThis.fetch = fetchMock as never;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('SetupAnimalHousing', () => {
  it('asks a helper to go to the owner', () => {
    render(SetupAnimalHousing, { areas: [], canEdit: false, onDone: vi.fn() });
    expect(screen.getByText(/Ask the owner to add a place/)).toBeInTheDocument();
  });

  it('picks an existing place without writing anything', async () => {
    const onDone = vi.fn();
    render(SetupAnimalHousing, {
      areas: [
        { id: 'b1', name: 'Red barn', kind: 'barn' },
        { id: 'w1', name: 'Woods', kind: 'natural_area' }
      ],
      canEdit: true,
      onDone
    });
    expect(screen.queryByText('Woods')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Use this place' }));
    expect(onDone).toHaveBeenCalledWith({
      areaId: 'b1',
      areaName: 'Red barn',
      kind: 'barn',
      created: false
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names a new barn with no map and creates it as an undrawn Area', async () => {
    const onDone = vi.fn();
    render(SetupAnimalHousing, { areas: [], canEdit: true, defaultKind: 'barn', onDone });
    await fireEvent.input(screen.getByLabelText('What do you call it?'), {
      target: { value: 'Hen house' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Use this place' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/fields');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Hen house', kind: 'barn' });
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ areaId: 'f9', created: true }));
  });

  it('refuses a new place with no name', async () => {
    render(SetupAnimalHousing, { areas: [], canEdit: true, onDone: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Use this place' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Give the place a name/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saves the species on a new coop made while adding animals (r6, #477)', async () => {
    render(SetupAnimalHousing, {
      areas: [],
      canEdit: true,
      defaultKind: 'coop_pen',
      speciesId: 'chicken',
      speciesName: 'chicken',
      onDone: vi.fn()
    });
    expect(screen.getByTestId('coop-species-note').textContent).toMatch(/suggested number/);
    await fireEvent.input(screen.getByLabelText('What do you call it?'), {
      target: { value: 'Hen house' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Use this place' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Hen house',
      kind: 'coop_pen',
      details: { speciesId: 'chicken' }
    });
  });
});
