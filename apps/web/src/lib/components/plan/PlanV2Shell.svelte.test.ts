/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { readable } from 'svelte/store';
import type { BlockWithPlantings } from '$lib/db/blocks';
import type { CalendarEvent } from '$lib/calendar/engine';

let currentUrl = new URL('http://localhost/plan');

vi.mock('$app/stores', () => ({
  page: {
    subscribe: (fn: (v: { url: URL }) => void) => readable({ url: currentUrl }).subscribe(fn)
  }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { default: PlanV2Shell } = await import('./PlanV2Shell.svelte');

// `events` collides with a Svelte mount option, so props go through `props:`.
const mount = (props: Record<string, unknown>) => render(PlanV2Shell, { props: props as never });

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  }
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

const BLOCKS = [
  {
    id: 'b1',
    name: 'Block A',
    acres: 0.5,
    tillageMethod: 'conventional',
    axesLocked: false,
    plantings: [
      {
        id: 'p1',
        blockId: 'b1',
        cropPluginId: 'corn',
        varietyDisplayName: 'Bloody Butcher',
        plantingDate: NOW - 20 * DAY,
        groupRole: 'anchor'
      },
      {
        id: 'p2',
        blockId: 'b1',
        cropPluginId: 'bean',
        varietyDisplayName: 'Cherokee Trail',
        plantingDate: NOW - 5 * DAY,
        groupRole: 'companion'
      }
    ]
  }
] as unknown as BlockWithPlantings[];

const EVENTS: CalendarEvent[] = [
  {
    kind: 'stage-window',
    blockId: 'b1',
    cropId: 'p1',
    cropPluginId: 'corn',
    varietyDisplayName: 'Bloody Butcher',
    startMs: NOW - 5 * DAY,
    endMs: NOW + 5 * DAY,
    title: 'V6 — Six leaf',
    detail: { stageCode: 'V6', stageName: 'Six leaf' }
  },
  {
    kind: 'harvest-window',
    blockId: 'b1',
    cropId: 'p1',
    cropPluginId: 'corn',
    varietyDisplayName: 'Bloody Butcher',
    startMs: NOW + 60 * DAY,
    endMs: NOW + 75 * DAY,
    title: 'Harvest window'
  }
];

const CROP_META = {
  corn: { displayName: 'Dent corn', daysToMaturity: 100 },
  bean: { displayName: 'Pole bean', daysToMaturity: 70 }
};

describe('PlanV2Shell (#119)', () => {
  it('wires role + calendar-engine stage into each planting card', () => {
    mount({ blocks: BLOCKS, tasks: [], events: EVENTS, cropMeta: CROP_META });
    expect(screen.getByText('Dent corn · Anchor')).toBeInTheDocument();
    expect(screen.getByText('Pole bean · Companion')).toBeInTheDocument();
    expect(screen.getByText('V6 · Six leaf')).toBeInTheDocument();
  });

  it('passes block status, harvest window, and the geometry badge to the header', () => {
    mount({
      blocks: BLOCKS,
      tasks: [],
      events: EVENTS,
      cropMeta: CROP_META,
      geometryEditHref: '/settings/farm/map'
    });
    expect(screen.getByTestId('geometry-missing')).toHaveAttribute('href', '/settings/farm/map');
    expect(screen.getByText(/^Harvest /)).toBeInTheDocument();
    expect(screen.getAllByText('active').length).toBeGreaterThan(0);
  });

  it('+ Task calls onAddTask with the selected block (all-plantings view → no planting)', async () => {
    const onAddTask = vi.fn();
    mount({
      blocks: BLOCKS,
      tasks: [],
      events: EVENTS,
      cropMeta: CROP_META,
      onAddTask
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(onAddTask).toHaveBeenCalledWith('b1', null);
  });

  it('+ Task carries the active planting when a planting tab is selected', async () => {
    currentUrl = new URL('http://localhost/plan?block=b1&planting=1');
    const onAddTask = vi.fn();
    mount({
      blocks: BLOCKS,
      tasks: [],
      events: EVENTS,
      cropMeta: CROP_META,
      onAddTask
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(onAddTask).toHaveBeenCalledWith('b1', 'p2');
    currentUrl = new URL('http://localhost/plan');
  });

  it('shows + Task on a block with no plantings', () => {
    const empty = [{ ...BLOCKS[0], id: 'b2', plantings: [] }] as BlockWithPlantings[];
    mount({ blocks: empty, tasks: [], cropMeta: {}, onAddTask: vi.fn() });
    expect(screen.getByRole('button', { name: 'Add task' })).toBeInTheDocument();
  });
});
