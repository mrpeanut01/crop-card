/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import SetupPlantingBackfill from './SetupPlantingBackfill.svelte';

const catalog = [
  { pluginId: 'alfalfa', displayName: 'Alfalfa', cropFamily: 'legume' },
  { pluginId: 'tomato', displayName: 'Tomato', cropFamily: 'solanaceae' }
];
const blocks = [{ id: 'b1', name: 'Back bed', areaName: 'Kitchen Garden' }];
const NOW = new Date(2026, 8, 26, 10);

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string | URL | Request) => {
    if (String(url) === '/api/fields') {
      return new Response(JSON.stringify({ field: { id: 'f9' } }), { status: 201 });
    }
    if (String(url) === '/api/blocks') {
      return new Response(JSON.stringify({ block: { id: 'b9', name: 'Hayfield' } }), {
        status: 201
      });
    }
    return new Response(JSON.stringify({ planting: { id: 'p1' } }), { status: 201 });
  });
  globalThis.fetch = fetchMock as never;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('SetupPlantingBackfill', () => {
  it('asks a helper to go to the owner', () => {
    render(SetupPlantingBackfill, { blocks, areas: [], canEdit: false, onDone: vi.fn(), catalog });
    expect(screen.getByText(/Ask the owner to add what's growing/)).toBeInTheDocument();
  });

  it('records a crop, spot and planted-around month as an active manual planting', async () => {
    const onDone = vi.fn();
    render(SetupPlantingBackfill, {
      blocks,
      areas: [],
      canEdit: true,
      onDone,
      catalog,
      now: NOW
    });
    const save = screen.getByRole('button', { name: 'Save planting' });
    expect(save).toBeDisabled();
    await fireEvent.input(screen.getByLabelText('What is it?'), { target: { value: 'tom' } });
    await fireEvent.click(screen.getByRole('button', { name: /Tomato/ }));
    await fireEvent.change(screen.getByLabelText('Planted around'), {
      target: { value: '2026-05' }
    });
    expect(screen.getByLabelText('Planting date')).toHaveValue('2026-05-15');
    expect(document.querySelector('[data-provenance="manual"]')).not.toBeNull();
    await fireEvent.click(save);
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({
        plantingId: 'p1',
        blockId: 'b1',
        cropPluginId: 'tomato'
      })
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/blocks/b1/plantings');
    const body = JSON.parse(init.body as string);
    expect(new Date(body.plantingDate).getMonth()).toBe(4);
    expect(body).not.toHaveProperty('sourceProvenance');
  });

  it('starts by naming a spot when the farm has none, then carries on', async () => {
    const onDone = vi.fn();
    render(SetupPlantingBackfill, {
      blocks: [],
      areas: [],
      canEdit: true,
      onDone,
      catalog,
      now: NOW
    });
    expect(screen.getByText('First, where is it growing?')).toBeInTheDocument();
    await fireEvent.input(screen.getByLabelText('What do you call it?'), {
      target: { value: 'Hayfield' }
    });
    await fireEvent.click(screen.getByLabelText(/Pasture/));
    await fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    const where = (await screen.findByLabelText('Where is it growing?')) as HTMLSelectElement;
    expect(where.value).toBe('b9');
    await fireEvent.input(screen.getByLabelText('What is it?'), { target: { value: 'alf' } });
    await fireEvent.click(screen.getByRole('button', { name: /Alfalfa/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save planting' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDone.mock.calls[0][0]).toMatchObject({ blockId: 'b9', cropPluginId: 'alfalfa' });
  });

  it('refuses a planting date in the future', async () => {
    render(SetupPlantingBackfill, {
      blocks,
      areas: [],
      canEdit: true,
      onDone: vi.fn(),
      catalog,
      now: NOW
    });
    await fireEvent.input(screen.getByLabelText('What is it?'), { target: { value: 'alf' } });
    await fireEvent.click(screen.getByRole('button', { name: /Alfalfa/ }));
    await fireEvent.input(screen.getByLabelText('Planting date'), {
      target: { value: '2026-10-01' }
    });
    await fireEvent.submit(screen.getByRole('button', { name: 'Save planting' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('on or before today');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
