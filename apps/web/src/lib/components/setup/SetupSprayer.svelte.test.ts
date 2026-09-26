/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

import SetupSprayer from './SetupSprayer.svelte';
import { SEED_EQUIPMENT_TEMPLATES } from '$lib/server/equipmentTemplates';
import { sprayerTiles } from '$lib/setup/sprayer';

const templates = sprayerTiles(SEED_EQUIPMENT_TEMPLATES);
const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === '/api/equipment') {
      const body = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ equipment: { id: 'eq1', label: body.label } }), {
        status: 201
      });
    }
    return new Response(JSON.stringify({ status: 'applied' }), { status: 200 });
  });
  globalThis.fetch = fetchMock as never;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('SetupSprayer', () => {
  it('tells a helper to ask the owner and offers no tiles', () => {
    render(SetupSprayer, { templates, canEdit: false, onDone: vi.fn() });
    expect(screen.getByText(/Ask the owner to add a sprayer/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Sprayer types' })).toBeNull();
  });

  it('shows one tile per starter sprayer', () => {
    render(SetupSprayer, { templates, canEdit: true, onDone: vi.fn() });
    const list = screen.getByRole('list', { name: 'Sprayer types' });
    expect(list.querySelectorAll('button.tile')).toHaveLength(6);
  });

  it('creates the sprayer on one tap and moves on to calibration', async () => {
    const onDone = vi.fn();
    render(SetupSprayer, { templates, canEdit: true, onDone });
    const tile = document.querySelector<HTMLButtonElement>(
      'button[data-template="sprayer-backpack-4gal"]'
    )!;
    await fireEvent.click(tile);
    await screen.findByText(/needs calibrating/);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByText('Spray width (in)')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('can skip calibration and hands back an uncalibrated sprayer', async () => {
    const onDone = vi.fn();
    render(SetupSprayer, { templates, canEdit: true, onDone });
    await fireEvent.click(
      document.querySelector<HTMLButtonElement>('button[data-template="sprayer-25gal-atv"]')!
    );
    await fireEvent.click(await screen.findByRole('button', { name: 'Calibrate later' }));
    expect(onDone).toHaveBeenCalledWith({
      sprayerId: 'eq1',
      label: '25 gal ATV/UTV-mount sprayer',
      calibratedGpa: null
    });
  });

  it('hands back the measured GPA once calibrated', async () => {
    const onDone = vi.fn();
    render(SetupSprayer, { templates, canEdit: true, onDone });
    await fireEvent.click(
      document.querySelector<HTMLButtonElement>('button[data-template="sprayer-25gal-atv"]')!
    );
    await screen.findByText(/needs calibrating/);
    expect(screen.getByText(/catch what ONE nozzle puts out/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Your stride (ft)')).toBeNull();
    const ounces = screen.getByLabelText('Fluid ounces from one nozzle');
    await fireEvent.input(ounces, { target: { value: '20' } });
    await fireEvent.click(await screen.findByRole('button', { name: /Save to/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(onDone.mock.calls[0][0]).toMatchObject({ sprayerId: 'eq1', calibratedGpa: 20 });
    const calibrationCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/calibration'));
    expect(calibrationCall).toBeDefined();
  });
});
