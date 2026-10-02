/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { pointFt } from '$lib/garden/geometry';
import DesignerToolbar from './DesignerToolbar.svelte';
import { DESIGNER_KEY, DesignerState, type DesignerInit } from './designerState.svelte';
import { CATALOG, fakeFetch, kitchenGarden, type FetchCall } from './fixtures';

function state(
  over: Partial<DesignerInit> = {},
  handler?: (c: FetchCall) => { status?: number; body?: unknown }
) {
  const f = fakeFetch(handler ?? (() => ({ body: { block: { id: 'new-bed' } } })));
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
  d.locate = (x, y) => ({ point: pointFt(x / 10, y / 10), bedId: null, onCanvas: x < 1000 });
  return { d, calls: f.calls, posts: () => f.calls.filter((c) => c.method === 'POST') };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

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

function mountToolbar(d: DesignerState) {
  return render(DesignerToolbar, {
    props: { oncustom: () => {} },
    context: new Map([[DESIGNER_KEY, d]])
  } as never);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('bed drag state', () => {
  it('drops a 4x8 bed centred under the pointer on open ground', async () => {
    const { d, posts } = state();
    expect(d.startBedDrag('raised-4x8', 0, 0)).toBe(true);
    d.moveBedDrag(160, 200);
    expect(d.bedDrag).toMatchObject({ rect: { x: 14, y: 16, w: 4, l: 8 }, fits: true });
    await d.dropBed();
    expect(d.bedDrag).toBeNull();
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toMatchObject({
      url: '/api/blocks',
      body: { fieldId: 'area1', widthFt: 4, lengthFt: 8, xFt: 14, yFt: 16, rotationDeg: 0 }
    });
    expect(d.bed('new-bed')?.rect).toMatchObject({ x: 14, y: 16 });
  });

  it('snaps and clamps like tap to place', async () => {
    const { d, posts } = state();
    d.startBedDrag('raised-4x8', 0, 0);
    d.moveBedDrag(199, 299);
    expect(d.bedDrag?.rect).toMatchObject({ x: 16, y: 22 });
    await d.dropBed();
    expect(posts()[0].body).toMatchObject({ xFt: 16, yFt: 22 });
  });

  it('refuses a drop onto a bed with the overlap message and saves nothing', async () => {
    const { d, posts } = state();
    d.startBedDrag('raised-4x8', 0, 0);
    d.moveBedDrag(40, 70);
    expect(d.bedDrag).toMatchObject({ rect: { x: 2, y: 3 }, fits: false });
    await d.dropBed();
    await flush();
    expect(posts()).toHaveLength(0);
    expect(d.alert).toBe("Beds can't overlap");
    expect(d.beds).toHaveLength(2);
  });

  it('refuses a drop on the canvas outside the garden', async () => {
    const { d, posts } = state();
    d.startBedDrag('raised-4x8', 0, 0);
    d.moveBedDrag(250, 50);
    expect(d.bedDrag).toMatchObject({ rect: null, fits: false });
    await d.dropBed();
    await flush();
    expect(posts()).toHaveLength(0);
    expect(d.alert).toBe('Beds stay inside the garden.');
  });

  it('puts the bed back when dropped off the canvas', async () => {
    const { d, posts } = state();
    d.startBedDrag('raised-4x8', 0, 0);
    d.moveBedDrag(1200, 50);
    await d.dropBed();
    await flush();
    expect(posts()).toHaveLength(0);
    expect(d.status).toBe('Put back.');
    expect(d.alert).toBe('');
  });

  it('a cancelled drag saves nothing and says so', async () => {
    const { d, posts } = state();
    d.startBedDrag('raised-4x8', 0, 0);
    d.moveBedDrag(160, 200);
    d.cancelBedDrag();
    expect(d.bedDrag).toBeNull();
    await d.dropBed();
    await flush();
    expect(posts()).toHaveLength(0);
    expect(d.status).toBe('Put back.');
  });

  it('rolls back when the server refuses the bed (OVERLAP)', async () => {
    const { d, posts } = state({}, (c) =>
      c.method === 'POST'
        ? { status: 409, body: { error: "Beds can't overlap", code: 'OVERLAP' } }
        : { body: {} }
    );
    d.startBedDrag('raised-4x8', 0, 0);
    d.moveBedDrag(160, 200);
    await d.dropBed();
    await flush();
    expect(posts()).toHaveLength(1);
    expect(d.beds).toHaveLength(2);
    expect(d.alert).not.toBe('');
  });

  it('does not drag Custom, in the List view, or for a helper', () => {
    expect(state().d.startBedDrag('custom', 0, 0)).toBe(false);
    const list = state();
    list.d.view = 'list';
    expect(list.d.startBedDrag('raised-4x8', 0, 0)).toBe(false);
    const helper = state({ canEdit: false });
    expect(helper.d.startBedDrag('raised-4x8', 0, 0)).toBe(false);
    expect(helper.d.bedDrag).toBeNull();
  });

  it('drops an armed place-bed mode when a drag starts', () => {
    const { d } = state();
    d.choosePreset('in-ground-3x10');
    expect(d.mode.kind).toBe('place-bed');
    d.startBedDrag('raised-4x8', 0, 0);
    expect(d.mode.kind).toBe('idle');
  });

  it('tap to place uses the same rule: overlap refused, open ground saved', async () => {
    const { d, posts } = state();
    d.choosePreset('raised-4x8');
    await d.placeBedAt(pointFt(2, 3));
    await flush();
    expect(d.alert).toBe("Beds can't overlap");
    expect(posts()).toHaveLength(0);
    await d.placeBedAt(pointFt(14, 16));
    expect(posts()[0].body).toMatchObject({ xFt: 14, yFt: 16 });
  });
});

describe('DesignerToolbar preset drag', () => {
  it('drags a chip by mouse after 6 px and drops it without also tapping', async () => {
    const { d, posts } = state();
    const { container } = mountToolbar(d);
    const chip = container.querySelector('[data-preset-id="raised-4x8"]')!;
    pointer('pointerdown', chip, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 10,
      clientY: 10
    });
    pointer('pointermove', window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 13,
      clientY: 12
    });
    expect(d.bedDrag).toBeNull();
    pointer('pointermove', window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 160,
      clientY: 200
    });
    expect(d.bedDrag?.fits).toBe(true);
    pointer('pointerup', window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 160,
      clientY: 200
    });
    await fireEvent.click(chip);
    await flush();
    expect(d.mode.kind).toBe('idle');
    expect(posts()).toHaveLength(1);
  });

  it('a mouse press without movement stays a tap', async () => {
    const { d, posts } = state();
    const { container } = mountToolbar(d);
    const chip = container.querySelector('[data-preset-id="raised-4x8"]')!;
    pointer('pointerdown', chip, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 10,
      clientY: 10
    });
    pointer('pointerup', window, { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10 });
    await fireEvent.click(chip);
    expect(d.mode).toMatchObject({ kind: 'place-bed', presetId: 'raised-4x8' });
    expect(posts()).toHaveLength(0);
  });

  it('a touch drag starts only after a hold; moving first is a scroll', async () => {
    vi.useFakeTimers();
    const { d } = state();
    const { container } = mountToolbar(d);
    const chip = container.querySelector('[data-preset-id="raised-4x8"]')!;
    pointer('pointerdown', chip, { pointerId: 3, pointerType: 'touch', clientX: 10, clientY: 10 });
    pointer('pointermove', window, {
      pointerId: 3,
      pointerType: 'touch',
      clientX: 10,
      clientY: 40
    });
    vi.advanceTimersByTime(400);
    expect(d.bedDrag).toBeNull();
    pointer('pointerup', window, { pointerId: 3, pointerType: 'touch', clientX: 10, clientY: 40 });

    pointer('pointerdown', chip, { pointerId: 4, pointerType: 'touch', clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(300);
    expect(d.bedDrag).toBeNull();
    vi.advanceTimersByTime(60);
    expect(d.bedDrag?.presetId).toBe('raised-4x8');
    const touchMove = new Event('touchmove', { cancelable: true });
    window.dispatchEvent(touchMove);
    expect(touchMove.defaultPrevented).toBe(true);
    pointer('pointermove', window, {
      pointerId: 4,
      pointerType: 'touch',
      clientX: 160,
      clientY: 200
    });
    expect(d.bedDrag?.rect).toMatchObject({ x: 14, y: 16 });
    pointer('pointercancel', window, { pointerId: 4, pointerType: 'touch' });
    expect(d.bedDrag).toBeNull();
  });

  it('a gloved hold released without moving still arms tap to place (D-32)', async () => {
    vi.useFakeTimers();
    const { d, posts } = state();
    const { container } = mountToolbar(d);
    const chip = container.querySelector('[data-preset-id="raised-4x8"]')!;
    for (const holdMs of [450, 700]) {
      d.mode = { kind: 'idle' };
      pointer('pointerdown', chip, {
        pointerId: holdMs,
        pointerType: 'touch',
        clientX: 10,
        clientY: 10
      });
      vi.advanceTimersByTime(holdMs);
      expect(d.bedDrag?.presetId).toBe('raised-4x8');
      pointer('pointermove', window, {
        pointerId: holdMs,
        pointerType: 'touch',
        clientX: 12,
        clientY: 13
      });
      pointer('pointerup', window, {
        pointerId: holdMs,
        pointerType: 'touch',
        clientX: 12,
        clientY: 13
      });
      await fireEvent.click(chip);
      expect(d.bedDrag).toBeNull();
      expect(d.mode).toMatchObject({ kind: 'place-bed', presetId: 'raised-4x8' });
      expect(d.status).not.toBe('Put back.');
      vi.advanceTimersByTime(1);
    }
    expect(posts()).toHaveLength(0);
  });

  it('a held drag that travels and comes back to the chip is put back', async () => {
    vi.useFakeTimers();
    const { d, posts } = state();
    const { container } = mountToolbar(d);
    const chip = container.querySelector('[data-preset-id="raised-4x8"]')!;
    pointer('pointerdown', chip, { pointerId: 9, pointerType: 'touch', clientX: 10, clientY: 10 });
    vi.advanceTimersByTime(400);
    pointer('pointermove', window, {
      pointerId: 9,
      pointerType: 'touch',
      clientX: 80,
      clientY: 90
    });
    pointer('pointerup', window, { pointerId: 9, pointerType: 'touch', clientX: 10, clientY: 10 });
    await Promise.resolve();
    expect(d.mode.kind).toBe('idle');
    expect(posts()).toHaveLength(0);
  });

  it('Escape cancels a live drag', async () => {
    const { d, posts } = state();
    const { container } = mountToolbar(d);
    const chip = container.querySelector('[data-preset-id="raised-4x8"]')!;
    pointer('pointerdown', chip, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 10,
      clientY: 10
    });
    pointer('pointermove', window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 160,
      clientY: 200
    });
    expect(d.bedDrag).not.toBeNull();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(d.bedDrag).toBeNull();
    pointer('pointerup', window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 160,
      clientY: 200
    });
    await flush();
    expect(posts()).toHaveLength(0);
    expect(d.status).toBe('Put back.');
  });

  it('Custom never starts a drag', () => {
    const { d } = state();
    const { container } = mountToolbar(d);
    const chip = container.querySelector('[data-preset-id="custom"]')!;
    pointer('pointerdown', chip, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 10,
      clientY: 10
    });
    pointer('pointermove', window, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 160,
      clientY: 200
    });
    expect(d.bedDrag).toBeNull();
  });
});
