/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';
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

describe('PlanV2Shell Area, Block and Planting cards (30G)', () => {
  const FIELDS = [
    { id: 'f1', name: 'North field', kind: 'field', acres: 2 },
    { id: 'g1', name: 'Kitchen garden', kind: 'garden', widthFt: 30, lengthFt: 40 }
  ];
  const TWO_AREAS = [
    { ...BLOCKS[0], fieldId: 'f1' },
    {
      id: 'b9',
      name: 'Bed 1',
      fieldId: 'g1',
      kind: 'bed',
      widthFt: 4,
      lengthFt: 8,
      tillageMethod: 'conventional',
      axesLocked: false,
      plantings: [
        {
          id: 'p9',
          blockId: 'b9',
          cropPluginId: 'bean',
          varietyDisplayName: 'Provider bush bean',
          plantingDate: NOW - 3 * DAY
        }
      ]
    },
    {
      id: 'b0',
      name: 'Loose block',
      tillageMethod: 'conventional',
      axesLocked: false,
      plantings: []
    }
  ] as unknown as BlockWithPlantings[];

  it('lists one compact Area card per Area plus blocks with no Area', () => {
    mount({ blocks: TWO_AREAS, fields: FIELDS, tasks: [], cropMeta: CROP_META });
    const rail = screen.getByTestId('plan-area-cards');
    const cards = [...rail.querySelectorAll('article')];
    expect(cards.map((c) => c.getAttribute('data-variant'))).toEqual([
      'compact',
      'compact',
      'compact'
    ]);
    expect(within(rail).getByRole('link', { name: 'North field' })).toHaveAttribute(
      'href',
      '/plan?field=f1'
    );
    expect(within(rail).getByRole('link', { name: 'Not in an Area' })).toHaveAttribute(
      'href',
      '/plan?field=none'
    );
    expect(screen.getByText('Areas · 2')).toBeInTheDocument();
    expect(rail.textContent).toContain('Bloody Butcher · Cherokee Trail');
    const garden = rail.querySelector('[data-area-id="g1"]')!;
    expect(garden.querySelector('a[href="/plan/areas/g1/design"]')?.textContent).toBe(
      'Open designer'
    );
  });

  it('marks the Area of the default block as selected and shows its Block cards', () => {
    mount({ blocks: TWO_AREAS, fields: FIELDS, tasks: [], events: EVENTS, cropMeta: CROP_META });
    const rail = screen.getByTestId('plan-area-cards');
    expect(within(rail).getByRole('link', { name: 'North field' })).toHaveAttribute(
      'aria-current',
      'true'
    );
    const blocks = screen.getByTestId('plan-block-cards');
    const link = blocks.querySelector('a')!;
    expect(link.textContent).toBe('Block A');
    expect(link.getAttribute('href')).toBe('/plan?field=f1&block=b1');
    expect(link.getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('Dent corn · Anchor')).toBeInTheDocument();
  });

  it('?field= selects a garden: bed map, Open designer, its beds and their plantings', () => {
    currentUrl = new URL('http://localhost/plan?field=g1');
    mount({ blocks: TWO_AREAS, fields: FIELDS, tasks: [], cropMeta: CROP_META });
    const view = screen.getByTestId('plan-area-view');
    expect(view.querySelector('[data-testid="card-bed-map"]')).not.toBeNull();
    expect(
      [...view.querySelectorAll('a')].some(
        (a) =>
          a.textContent === 'Open designer' && a.getAttribute('href') === '/plan/areas/g1/design'
      )
    ).toBe(true);
    expect(screen.getByRole('link', { name: 'Bed 1' })).toHaveAttribute(
      'href',
      '/plan?field=g1&block=b9'
    );
    expect(screen.getByRole('link', { name: 'Provider bush bean' })).toHaveAttribute(
      'href',
      '/crops/p9'
    );
    currentUrl = new URL('http://localhost/plan');
  });

  it('filters Area cards by bed or crop name', async () => {
    mount({ blocks: TWO_AREAS, fields: FIELDS, tasks: [], cropMeta: CROP_META });
    const filter = screen.getByRole('searchbox', { name: /Filter Areas/ });
    await fireEvent.input(filter, { target: { value: 'provider' } });
    const rail = screen.getByTestId('plan-area-cards');
    expect([...rail.querySelectorAll('li')].map((l) => l.getAttribute('data-area-id'))).toEqual([
      'g1'
    ]);
  });

  it('an empty crop Area offers Plan a crop here to the owner only', () => {
    currentUrl = new URL('http://localhost/plan?field=f2');
    const fields = [...FIELDS, { id: 'f2', name: 'East field', kind: 'field', acres: 1 }];
    const owner = mount({ blocks: TWO_AREAS, fields, tasks: [], cropMeta: CROP_META });
    expect(screen.getByTestId('plan-area-empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Plan a crop here/ })).toHaveAttribute(
      'href',
      '/plan?area=f2'
    );
    owner.unmount();
    mount({ blocks: TWO_AREAS, fields, tasks: [], cropMeta: CROP_META, canEdit: false });
    expect(screen.queryByRole('link', { name: /Plan a crop here/ })).toBeNull();
    currentUrl = new URL('http://localhost/plan');
  });
});
