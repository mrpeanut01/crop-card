/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));

import AreaCardSheet from './AreaCardSheet.svelte';
import AreaAddDrawer from './AreaAddDrawer.svelte';
import MapFilterPanel from './MapFilterPanel.svelte';
import { sampleSnapshot } from '$lib/cards/build/fixtures';
import { kindCounts } from '$lib/farm/kindStyle';
import { DEFAULT_MAP_FILTER } from '$lib/farm/mapFilter';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close ??= vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

function snapWithHistory() {
  const s = sampleSnapshot();
  s.plantings.push({
    ...s.plantings[0],
    id: 'p_old',
    varietyDisplayName: 'Sungold tomato',
    status: 'harvested',
    plantingDate: '2025-05-01',
    harvestedAt: '2025-08-20'
  });
  return s;
}

const garden = {
  id: 'f_garden',
  name: 'Kitchen Garden',
  kind: 'garden' as const,
  details: { irrigation: 'drip' as const }
};

describe('AreaCardSheet', () => {
  it('opens on Details with the Area Card and stored details', () => {
    render(AreaCardSheet, {
      open: true,
      onClose: vi.fn(),
      snapshot: snapWithHistory(),
      area: garden,
      canEdit: true
    });
    const sheet = screen.getByTestId('area-card-sheet');
    expect(sheet.dataset.areaKind).toBe('garden');
    expect(screen.getByRole('tab', { name: /Details/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(sheet).getByRole('article', { name: 'Kitchen Garden' })).toBeInTheDocument();
    expect(within(sheet).getByText('Watering')).toBeInTheDocument();
    expect(within(sheet).getByText('Drip')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Edit details' })).toBeInTheDocument();
  });

  it('lists the animals housed on a coop with its capacity, and hides tags for pets', () => {
    const s = sampleSnapshot();
    s.areas.push({ ...s.areas[0], id: 'f_coop', name: 'Hen House', kind: 'coop_pen' });
    render(AreaCardSheet, {
      open: true,
      onClose: vi.fn(),
      snapshot: s,
      area: { id: 'f_coop', name: 'Hen House', kind: 'coop_pen', details: { capacity: 24 } },
      canEdit: false,
      petsLayout: true,
      housing: {
        groups: [
          { id: 'g1', name: 'Layers', speciesPlural: 'Chickens', total: 24, foodProducing: true }
        ],
        animals: [
          {
            id: 'a1',
            name: null,
            tag: '9',
            speciesName: 'Duck',
            purpose: 'production',
            foodProducing: true
          }
        ],
        total: 25,
        capacity: { capacity: 24, count: 25, over: true }
      }
    });
    const sheet = screen.getByTestId('area-card-sheet');
    expect(within(sheet).getByText('Lives here')).toBeInTheDocument();
    expect(within(sheet).getByText('Layers · 24 chickens · food animals')).toBeInTheDocument();
    expect(within(sheet).getByText('Duck · food animal')).toBeInTheDocument();
    expect(within(sheet).getByText('Over capacity (25 of 24)')).toBeInTheDocument();
    expect(within(sheet).getByText('Holds up to')).toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/Tag 9|livestock/i);
    expect(within(sheet).getByRole('link', { name: 'Open Pets & animals' })).toHaveAttribute(
      'href',
      '/animals'
    );
  });

  it('sends an undrawn Area with no beds to Plan for that Area, not bare /plan', async () => {
    const s = sampleSnapshot();
    s.areas.push({ ...s.areas[0], id: 'f_new', name: 'Hayfield', kind: 'pasture' });
    render(AreaCardSheet, {
      open: true,
      onClose: vi.fn(),
      snapshot: s,
      area: { id: 'f_new', name: 'Hayfield', kind: 'pasture', details: null },
      canEdit: true
    });
    await fireEvent.click(screen.getByRole('tab', { name: /Plantings/ }));
    expect(screen.getByRole('link', { name: 'Plan a crop here' })).toHaveAttribute(
      'href',
      '/plan?area=f_new'
    );
  });

  it('History links to the Records for each bed in the Area', async () => {
    render(AreaCardSheet, {
      open: true,
      onClose: vi.fn(),
      snapshot: sampleSnapshot(),
      area: garden,
      canEdit: true
    });
    await fireEvent.click(screen.getByRole('tab', { name: /History/ }));
    const links = within(screen.getByTestId('area-records-links')).getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute('href')).toMatch(/^\/records\?blockId=/);
  });

  it('shows helpers the designer link but no detail editing', () => {
    render(AreaCardSheet, {
      open: true,
      onClose: vi.fn(),
      snapshot: sampleSnapshot(),
      area: garden,
      canEdit: false
    });
    expect(screen.getByRole('link', { name: 'Open designer' })).toHaveAttribute(
      'href',
      '/plan/areas/f_garden/design'
    );
    expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull();
  });

  it('links the designer for a garden, and never for a pasture', () => {
    const { unmount } = render(AreaCardSheet, {
      open: true,
      onClose: vi.fn(),
      snapshot: sampleSnapshot(),
      area: garden,
      canEdit: true
    });
    expect(screen.getByRole('link', { name: 'Open designer' })).toHaveAttribute(
      'href',
      '/plan/areas/f_garden/design'
    );
    unmount();
    render(AreaCardSheet, {
      open: true,
      onClose: vi.fn(),
      snapshot: sampleSnapshot(),
      area: { id: 'f_hay', name: 'Hayfield', kind: 'pasture', details: null },
      canEdit: true
    });
    expect(screen.queryByText('Open designer')).toBeNull();
  });

  it('switches between Plantings, Tasks and History', async () => {
    render(AreaCardSheet, {
      open: true,
      onClose: vi.fn(),
      snapshot: snapWithHistory(),
      area: garden,
      canEdit: true
    });
    await fireEvent.click(screen.getByRole('tab', { name: /Plantings/ }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Cherokee Purple tomato')).toBeInTheDocument();
    expect(within(panel).getByText('Provider bush bean')).toBeInTheDocument();
    expect(within(panel).queryByText('Sungold tomato')).toBeNull();

    await fireEvent.click(screen.getByRole('tab', { name: /Tasks/ }));
    const tasks = screen.getByRole('tabpanel');
    const links = within(tasks).getAllByRole('link');
    expect(links[0]).toHaveTextContent('Side-dress');
    expect(links[0]).toHaveAttribute('href', '/plan?block=b_bed3#plan-scheduled-tasks');

    await fireEvent.click(screen.getByRole('tab', { name: /History/ }));
    expect(within(screen.getByRole('tabpanel')).getByText('Sungold tomato')).toBeInTheDocument();
    expect(screen.getByText(/harvested Aug 20/)).toBeInTheDocument();
  });

  it('adds the forage check once it loads, and says so when it cannot', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith('/api/forage/advisory')
        ? new Response('{}', { status: 500 })
        : new Response('{}', { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(AreaCardSheet, {
      open: true,
      onClose: vi.fn(),
      snapshot: sampleSnapshot(),
      area: garden,
      canEdit: true
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/forage/advisory?fieldId=f_garden');
    expect(await screen.findByText('Could not load the forage check.')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('edits kind-aware details in place', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(AreaCardSheet, {
      open: true,
      onClose: vi.fn(),
      snapshot: sampleSnapshot(),
      area: garden,
      canEdit: true
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
    await fireEvent.change(screen.getByLabelText('Organic status'), {
      target: { value: 'organic' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/fields/f_garden',
      expect.objectContaining({ method: 'PATCH' })
    );
    const patch = (fetchMock.mock.calls as unknown as Array<[string, RequestInit?]>).find(
      ([, init]) => init?.method === 'PATCH'
    )!;
    const body = JSON.parse(patch[1]!.body as string);
    expect(body).toEqual({
      name: 'Kitchen Garden',
      kind: 'garden',
      details: { organicStatus: 'organic', irrigation: 'drip' }
    });
    vi.unstubAllGlobals();
  });
});

describe('AreaAddDrawer', () => {
  it('groups kinds and reports the pick', async () => {
    const onPick = vi.fn();
    render(AreaAddDrawer, { open: true, onClose: vi.fn(), onPick });
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Crop areas', 'Other areas', 'Lines & points', 'Shade & structures']);
    await fireEvent.click(screen.getByRole('button', { name: /Garden/ }));
    expect(onPick).toHaveBeenCalledWith({ type: 'area', kind: 'garden' });
    await fireEvent.click(screen.getByRole('button', { name: /Block or bed/ }));
    expect(onPick).toHaveBeenLastCalledWith({ type: 'block' });
  });

  it('leaves shade and blocks out of the size sketch', () => {
    render(AreaAddDrawer, { open: true, onClose: vi.fn(), onPick: vi.fn(), mode: 'sketch' });
    expect(screen.queryByText('Shade & structures')).toBeNull();
    expect(screen.queryByText('Block or bed')).toBeNull();
    expect(screen.getByRole('button', { name: /Barn/ })).toBeInTheDocument();
  });
});

describe('MapFilterPanel', () => {
  it('toggles kinds present on the farm plus labels and satellite', async () => {
    const onChange = vi.fn();
    render(MapFilterPanel, {
      open: true,
      onClose: vi.fn(),
      filter: { ...DEFAULT_MAP_FILTER, hidden: [] },
      onChange,
      counts: kindCounts([{ kind: 'garden' }, { kind: 'pasture' }]),
      hasShade: true
    });
    const panel = screen.getByTestId('map-filter');
    expect(within(panel).queryByText('Barn')).toBeNull();
    await fireEvent.click(within(panel).getByRole('checkbox', { name: /Garden/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ hidden: ['garden'] }));
    await fireEvent.click(within(panel).getByRole('checkbox', { name: 'Satellite' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ satellite: false }));
    expect(within(panel).getByRole('checkbox', { name: 'Shade & structures' })).toBeChecked();
  });
});
