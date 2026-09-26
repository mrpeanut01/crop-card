/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { pointFt } from '$lib/garden/geometry';
import BedInspector from './BedInspector.svelte';
import CropPanel from './CropPanel.svelte';
import { DESIGNER_KEY, DesignerState, type DesignerInit } from './designerState.svelte';
import {
  CATALOG,
  LETTUCE,
  fakeFetch,
  kitchenGarden,
  plantingRow,
  type FetchCall
} from './fixtures';

function state(
  over: Partial<DesignerInit> = {},
  handler?: (c: FetchCall) => { status?: number; body?: unknown }
) {
  const f = fakeFetch(handler ?? (() => ({ body: {} })));
  let d!: DesignerState;
  $effect.root(() => {
    d = new DesignerState({
      design: kitchenGarden(),
      history: {},
      catalog: CATALOG,
      companions: [],
      lookbackByFamily: {},
      canEdit: true,
      nowMs: Date.UTC(2026, 2, 1),
      fetch: f.fetch,
      ...over
    });
  });
  return { d, calls: f.calls };
}

function mount<P extends Record<string, unknown>>(c: Component<P>, d: DesignerState, props: P) {
  return render(c, { props, context: new Map([[DESIGNER_KEY, d]]) } as never);
}

function pointer(type: string, target: EventTarget, init: Record<string, unknown>) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  for (const [k, v] of Object.entries(init)) {
    if (!(k in e) || (e as unknown as Record<string, unknown>)[k] !== v) {
      Object.defineProperty(e, k, { value: v });
    }
  }
  target.dispatchEvent(e);
  return e;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('CropPanel drag to place', () => {
  it('drags a crop row by mouse onto a bed without also treating it as a tap', async () => {
    const { d, calls } = state({}, (c) =>
      c.method === 'POST' ? { status: 500, body: { error: 'stop here' } } : { body: {} }
    );
    d.locate = (x, y) => ({ point: pointFt(x / 10, y / 10), bedId: 'bed1' });
    d.openCropPanel(null);
    const { getByLabelText, getAllByTestId } = mount(CropPanel, d, {});
    await fireEvent.input(getByLabelText('Search crops'), { target: { value: 'lettuce' } });
    const row = getAllByTestId('crop-row')[0];
    pointer('pointerdown', row, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 30,
      clientY: 50
    });
    pointer('pointermove', window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 32,
      clientY: 51
    });
    expect(d.cropDrag).toBeNull();
    pointer('pointermove', window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 40,
      clientY: 60
    });
    expect(d.cropDrag).toMatchObject({ bedId: 'bed1', choice: { pluginId: LETTUCE.pluginId } });
    pointer('pointerup', window, { pointerId: 1, pointerType: 'mouse', clientX: 40, clientY: 60 });
    await fireEvent.click(row);
    await flush();
    expect(d.cropDrag).toBeNull();
    expect(d.mode.kind).toBe('idle');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('a touch on the row itself scrolls; only the handle starts a drag', async () => {
    const { d } = state();
    d.locate = (x, y) => ({ point: pointFt(x / 10, y / 10), bedId: 'bed1' });
    d.openCropPanel(null);
    const { getByLabelText, getAllByTestId } = mount(CropPanel, d, {});
    await fireEvent.input(getByLabelText('Search crops'), { target: { value: 'lettuce' } });
    const row = getAllByTestId('crop-row')[0];
    pointer('pointerdown', row, { pointerId: 7, pointerType: 'touch', clientX: 30, clientY: 50 });
    pointer('pointermove', window, {
      pointerId: 7,
      pointerType: 'touch',
      clientX: 30,
      clientY: 150
    });
    expect(d.cropDrag).toBeNull();
    pointer('pointerup', window, { pointerId: 7, pointerType: 'touch', clientX: 30, clientY: 150 });

    const grip = row.querySelector('[data-drag-grip]')!;
    expect(grip).not.toBeNull();
    pointer('pointerdown', grip, { pointerId: 8, pointerType: 'touch', clientX: 30, clientY: 50 });
    pointer('pointermove', window, {
      pointerId: 8,
      pointerType: 'touch',
      clientX: 60,
      clientY: 90
    });
    expect(d.cropDrag?.bedId).toBe('bed1');
    pointer('pointercancel', window, { pointerId: 8, pointerType: 'touch' });
    expect(d.cropDrag).toBeNull();
  });

  it('has no drag handle for a helper or in the List view', async () => {
    const helper = state({ canEdit: false });
    helper.d.openCropPanel(null);
    const a = mount(CropPanel, helper.d, {});
    await fireEvent.input(a.getByLabelText('Search crops'), { target: { value: 'lettuce' } });
    expect(a.container.querySelector('[data-drag-grip]')).toBeNull();
    a.unmount();

    const list = state();
    list.d.view = 'list';
    list.d.openCropPanel(null);
    const b = mount(CropPanel, list.d, {});
    await fireEvent.input(b.getByLabelText('Search crops'), { target: { value: 'lettuce' } });
    expect(b.container.querySelector('[data-drag-grip]')).toBeNull();
  });
});

describe('BedInspector Move to bed', () => {
  it('offers the other beds for a planned planting and moves it there', async () => {
    const design = kitchenGarden({
      plantings: [
        plantingRow({
          id: 'let',
          cropPluginId: LETTUCE.pluginId,
          varietyDisplayName: 'Lettuce',
          plantingDateMs: Date.UTC(2026, 3, 1),
          footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 24 }
        })
      ]
    });
    const { d, calls } = state({ design });
    d.selectPlanting('let');
    const { getByTestId } = mount(BedInspector, d, { bed: d.bed('bed1')! });
    const form = getByTestId('move-to-bed');
    const select = within(form).getByRole('combobox', { name: /Bed to move Lettuce/ });
    expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual(['Bed 2']);
    await fireEvent.submit(form);
    await flush();
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      url: '/api/crops/let',
      body: { action: 'set-placement', blockId: 'bed2' }
    });
  });

  it('hides Move to bed once the planting is in the ground', () => {
    const design = kitchenGarden({
      plantings: [
        plantingRow({
          id: 'let',
          status: 'active',
          cropPluginId: LETTUCE.pluginId,
          varietyDisplayName: 'Lettuce',
          plantingDateMs: Date.UTC(2026, 1, 1),
          footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 24 }
        })
      ]
    });
    const { d } = state({ design });
    d.selectPlanting('let');
    const { queryByTestId } = mount(BedInspector, d, { bed: d.bed('bed1')! });
    expect(queryByTestId('move-to-bed')).toBeNull();
  });
});
