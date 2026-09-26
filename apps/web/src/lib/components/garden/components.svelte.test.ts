/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, within } from '@testing-library/svelte';
import type { Component } from 'svelte';
import DesignerCanvas from './DesignerCanvas.svelte';
import DesignerListView from './DesignerListView.svelte';
import DesignerToolbar from './DesignerToolbar.svelte';
import TimeScrubber from './TimeScrubber.svelte';
import BedInspector from './BedInspector.svelte';
import { DESIGNER_KEY, DesignerState, type DesignerInit } from './designerState.svelte';
import { CATALOG, fakeFetch, kitchenGarden, plantingRow, type FetchCall } from './fixtures';

function state(
  over: Partial<DesignerInit> = {},
  handler?: (c: FetchCall) => { status?: number; body?: unknown }
) {
  const f = fakeFetch(handler ?? (() => ({ status: 201, body: { block: { id: 'b3' } } })));
  let d!: DesignerState;
  $effect.root(() => {
    d = new DesignerState({
      design: kitchenGarden(),
      history: {},
      catalog: CATALOG,
      companions: [],
      lookbackByFamily: {},
      canEdit: true,
      nowMs: Date.UTC(2026, 4, 1),
      fetch: f.fetch,
      ...over
    });
  });
  return { d, calls: f.calls };
}

function mount<P extends Record<string, unknown>>(c: Component<P>, d: DesignerState, props: P) {
  return render(c, { props, context: new Map([[DESIGNER_KEY, d]]) } as never);
}

const noop = () => {};

describe('DesignerCanvas', () => {
  it('draws each bed as a labelled, focusable button in a labelled group', () => {
    const { d } = state();
    const { getByRole, getAllByTestId } = mount(DesignerCanvas, d, {});
    expect(
      getByRole('group', { name: 'Kitchen Garden layout, 20 by 30 feet' })
    ).toBeInTheDocument();
    const beds = getAllByTestId('bed');
    expect(beds.map((b) => b.getAttribute('data-bed-name'))).toEqual(['Bed 1', 'Bed 2']);
    expect(beds[0]).toHaveAttribute('role', 'button');
    expect(beds[0]).toHaveAttribute('tabindex', '0');
    expect(beds[0]).toHaveAttribute('aria-pressed', 'false');
    expect(beds[0].getAttribute('aria-label')).toBe(
      'Bed 1, 4 by 8 foot raised bed, 2 feet from west, 3 feet from north. On May 1: open.'
    );
  });

  it('Enter selects a bed, Enter again picks it up, arrows move it and Enter drops it', async () => {
    const { d, calls } = state({}, () => ({ body: {} }));
    const { getAllByTestId } = mount(DesignerCanvas, d, {});
    const bed2 = getAllByTestId('bed')[1];
    await fireEvent.keyDown(bed2, { key: 'Enter' });
    expect(d.selectedBedId).toBe('bed2');
    expect(bed2).toHaveAttribute('aria-pressed', 'true');
    await fireEvent.keyDown(bed2, { key: 'Enter' });
    expect(d.mode.kind).toBe('carry-bed');
    await fireEvent.keyDown(bed2, { key: 'ArrowRight', shiftKey: true });
    await fireEvent.keyDown(bed2, { key: 'ArrowDown' });
    await fireEvent.keyDown(bed2, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { xFt: 13, yFt: 3.5 } });
  });

  it('draws footprints in the ground on the scrubber date with a stage', () => {
    const { d } = state({
      design: kitchenGarden({
        plantings: [plantingRow({ id: 'tom', footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 } })]
      })
    });
    d.setDate(Date.UTC(2026, 6, 15));
    const { getAllByTestId } = mount(DesignerCanvas, d, {});
    const fp = getAllByTestId('footprint');
    expect(fp).toHaveLength(1);
    expect(fp[0].getAttribute('aria-label')).toMatch(/3 plants, harvesting/);
  });
});

describe('DesignerToolbar', () => {
  it('shows the preset bar to an owner and nothing to a helper', () => {
    const owner = state();
    const a = mount(DesignerToolbar, owner.d, { oncustom: noop });
    expect(a.getByRole('toolbar', { name: 'Add a bed' })).toBeInTheDocument();
    for (const b of a.getAllByRole('button')) {
      expect(b.className).toMatch(/tb/);
    }
    a.unmount();
    const helper = state({ canEdit: false });
    const b = mount(DesignerToolbar, helper.d, { oncustom: noop });
    expect(b.queryByRole('toolbar')).toBeNull();
  });

  it('swaps to the bed toolbar when a bed is selected', async () => {
    const { d } = state();
    d.selectBed('bed1');
    const { getByRole } = mount(DesignerToolbar, d, { oncustom: noop });
    const bar = getByRole('toolbar', { name: 'Bed 1 actions' });
    for (const name of [
      'Move',
      'Turn',
      'Duplicate',
      'Size',
      'Rename',
      'Add crop',
      'Delete',
      'Done'
    ]) {
      expect(within(bar).getByRole('button', { name })).toBeInTheDocument();
    }
  });
});

describe('DesignerListView', () => {
  it('lists beds with size, position and what is in them, and adds a bed at a free spot', async () => {
    const { d, calls } = state();
    const { getAllByTestId, getByRole } = mount(DesignerListView, d, { oncustom: noop });
    const rows = getAllByTestId('list-bed');
    expect(rows.map((r) => r.getAttribute('data-bed-name'))).toEqual(['Bed 1', 'Bed 2']);
    expect(rows[0]).toHaveTextContent('4×8 ft');
    expect(rows[0]).toHaveTextContent('2 ft from west, 3 ft from north');
    expect(rows[0]).toHaveTextContent('In it: Nothing');
    await fireEvent.click(getByRole('button', { name: 'Add bed' }));
    await fireEvent.click(getByRole('button', { name: '4×8 raised bed' }));
    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: { name: 'Bed 3', widthFt: 4, lengthFt: 8 }
    });
  });

  it('expands a row into the same bed sheet', async () => {
    const { d } = state();
    const { getAllByTestId, getByTestId } = mount(DesignerListView, d, { oncustom: noop });
    await fireEvent.click(within(getAllByTestId('list-bed')[1]).getAllByRole('button')[0]);
    const sheet = getByTestId('bed-sheet');
    expect(sheet).toHaveAttribute('data-bed-name', 'Bed 2');
    for (const name of ['Turn', 'Duplicate', 'Add crop', 'Delete']) {
      expect(within(sheet).getByRole('button', { name })).toBeInTheDocument();
    }
  });
});

describe('BedInspector', () => {
  it('a helper reads details and history but gets no write buttons', async () => {
    const { d } = state({ canEdit: false });
    const { getByLabelText, queryByRole, getByRole } = mount(BedInspector, d, {
      bed: d.bed('bed1')!
    });
    expect(getByLabelText('Name')).toBeDisabled();
    expect(queryByRole('button', { name: 'Delete' })).toBeNull();
    await fireEvent.click(getByRole('tab', { name: 'History' }));
    expect(getByRole('heading', { name: 'Bed history' })).toBeInTheDocument();
  });

  it('shows the plant count with its provenance tag', async () => {
    const { d } = state({
      design: kitchenGarden({
        plantings: [plantingRow({ id: 'tom', footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 96 } })]
      })
    });
    const { getByRole, getByTestId } = mount(BedInspector, d, { bed: d.bed('bed1')! });
    await fireEvent.click(getByRole('tab', { name: 'Plantings' }));
    expect(getByTestId('plant-count')).toHaveTextContent('3 plants');
    expect(getByTestId('plant-count')).toHaveTextContent('4×8 ft · Rows');
  });
});

describe('TimeScrubber', () => {
  const range = {
    startMs: Date.UTC(2026, 0, 1),
    endMs: Date.UTC(2026, 11, 31),
    todayMs: Date.UTC(2026, 4, 1)
  };

  it('is a native slider that reads its value as a date and jumps between changes with PageDown', async () => {
    let value = Date.UTC(2026, 4, 1);
    const { getByRole } = render(TimeScrubber, {
      props: {
        range,
        value,
        changeDays: [Date.UTC(2026, 6, 1)],
        lastSpringFrostMs: Date.UTC(2026, 3, 15),
        firstFallFrostMs: Date.UTC(2026, 9, 24),
        wholeSeason: false,
        onchange: (ms: number) => (value = ms),
        onwholeseason: noop
      }
    });
    const slider = getByRole('slider');
    expect(slider).toHaveAttribute('aria-valuetext', 'May 1');
    await fireEvent.keyDown(slider, { key: 'PageDown' });
    expect(value).toBe(Date.UTC(2026, 6, 1));
  });
});
