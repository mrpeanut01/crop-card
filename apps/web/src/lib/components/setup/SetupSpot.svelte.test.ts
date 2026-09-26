/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import SetupSpot from './SetupSpot.svelte';

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string | URL | Request) => {
    if (String(url) === '/api/fields') {
      return new Response(JSON.stringify({ field: { id: 'f1' } }), { status: 201 });
    }
    return new Response(JSON.stringify({ block: { id: 'b1', name: 'Back bed' } }), {
      status: 201
    });
  });
  globalThis.fetch = fetchMock as never;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('SetupSpot', () => {
  it('asks a helper to go to the owner', () => {
    render(SetupSpot, { areas: [], canEdit: false, onDone: vi.fn() });
    expect(screen.getByText(/Ask the owner to add a spot/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save this spot' })).toBeNull();
  });

  it('names a new garden spot with no map and returns the new block', async () => {
    const onDone = vi.fn();
    render(SetupSpot, { areas: [], canEdit: true, onDone });
    await fireEvent.input(screen.getByLabelText('What do you call it?'), {
      target: { value: 'Back bed' }
    });
    await fireEvent.click(screen.getByLabelText(/Garden/));
    await fireEvent.click(screen.getByRole('button', { name: 'Save this spot' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({ blockId: 'b1', blockName: 'Back bed', areaId: 'f1' })
    );
    const blockBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(blockBody.kind).toBe('bed');
  });

  it('can put the spot inside an existing Area', async () => {
    const onDone = vi.fn();
    render(SetupSpot, {
      areas: [{ id: 'a1', name: 'Home Field', kind: 'field' }],
      canEdit: true,
      onDone
    });
    await fireEvent.input(screen.getByLabelText('What do you call it?'), {
      target: { value: 'North 10' }
    });
    await fireEvent.change(screen.getByLabelText('Where is it?'), { target: { value: 'a1' } });
    expect(screen.queryByText('What kind of place is it?')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Save this spot' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/blocks');
  });

  it('starts inside the matching starter Area and offers its name for an empty one', () => {
    render(SetupSpot, {
      areas: [
        { id: 'a1', name: 'Home Field', kind: 'field', blockCount: 2 },
        { id: 'a2', name: 'Hayfield', kind: 'pasture', blockCount: 0 }
      ],
      canEdit: true,
      defaultKind: 'pasture',
      onDone: vi.fn()
    });
    expect(screen.getByLabelText('Where is it?')).toHaveValue('a2');
    const name = screen.getByLabelText('What do you call it?');
    expect(name).toHaveValue('Hayfield');
    expect(name).toHaveAttribute('placeholder', 'e.g. Upper paddock');
    expect(screen.queryByText('What kind of place is it?')).toBeNull();
  });

  it('shows the server error in plain words', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 403 }));
    render(SetupSpot, { areas: [], canEdit: true, onDone: vi.fn() });
    await fireEvent.input(screen.getByLabelText('What do you call it?'), {
      target: { value: 'Back bed' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save this spot' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only the farm owner can add places.'
    );
  });
});
