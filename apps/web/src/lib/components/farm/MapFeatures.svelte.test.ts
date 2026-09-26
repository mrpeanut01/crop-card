/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';

import AreaAddDrawer from './AreaAddDrawer.svelte';
import MapFilterPanel from './MapFilterPanel.svelte';
import MapFeatureList from './MapFeatureList.svelte';
import FarmMapFigure from './FarmMapFigure.svelte';
import { kindCounts } from '$lib/farm/kindStyle';
import { DEFAULT_MAP_FILTER } from '$lib/farm/mapFilter';
import { featureCounts, type MapFeatureView } from '$lib/farm/mapFeatures';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close ??= vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

const fence: MapFeatureView = {
  id: 'mf_fence',
  kind: 'fence',
  name: 'Pasture fence',
  fieldId: 'f1',
  geometry: {
    type: 'LineString',
    coordinates: [
      [-77.55, 39.1],
      [-77.549, 39.1]
    ]
  },
  details: null,
  lengthFt: 283
};
const well: MapFeatureView = {
  id: 'mf_well',
  kind: 'water_source',
  name: 'Barn well',
  fieldId: null,
  geometry: { type: 'Point', coordinates: [-77.5495, 39.1] },
  details: { source: 'well', flowRateGpm: 12 },
  lengthFt: null
};

describe('Add drawer lines and points', () => {
  it('offers every line and point on the map, and none in Dimensions', async () => {
    const onPick = vi.fn();
    const { unmount } = render(AreaAddDrawer, { open: true, onClose: vi.fn(), onPick });
    const dialog = screen.getByRole('dialog', { name: 'Add to map' });
    const drawer = within(dialog).getByRole('region', { name: 'Lines & points' });
    for (const label of ['Fence', 'Gate', 'Water source', 'Hydrant', 'Irrigation line', 'Path']) {
      expect(within(drawer).getByRole('button', { name: new RegExp(`^${label}`) })).toBeTruthy();
    }
    await fireEvent.click(within(drawer).getByRole('button', { name: /^Water source/ }));
    expect(onPick).toHaveBeenCalledWith({ type: 'feature', kind: 'water_source' });
    unmount();

    render(AreaAddDrawer, { open: true, onClose: vi.fn(), onPick, mode: 'sketch' });
    const sketch = screen.getByRole('dialog', { name: 'Add to map' });
    expect(within(sketch).queryByRole('heading', { name: 'Lines & points' })).toBeNull();
    expect(within(sketch).getByText(/go on the Map view/)).toBeInTheDocument();
  });
});

describe('Filter lines and points', () => {
  it('lists only kinds on the farm and toggles one without touching Areas', async () => {
    const onChange = vi.fn();
    render(MapFilterPanel, {
      open: true,
      onClose: vi.fn(),
      filter: { ...DEFAULT_MAP_FILTER, hidden: [], hiddenFeatures: [] },
      onChange,
      counts: kindCounts([{ kind: 'pasture' }]),
      featureCounts: featureCounts([fence, well])
    });
    const panel = screen.getByTestId('map-filter');
    expect(within(panel).getByText('Lines & points')).toBeInTheDocument();
    expect(within(panel).queryByRole('checkbox', { name: /Gates/ })).toBeNull();
    await fireEvent.click(within(panel).getByRole('checkbox', { name: /Fences/ }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ hidden: [], hiddenFeatures: ['fence'] })
    );
  });

  it('leaves the group out when the farm has no lines or points', () => {
    render(MapFilterPanel, {
      open: true,
      onClose: vi.fn(),
      filter: { ...DEFAULT_MAP_FILTER, hidden: [], hiddenFeatures: [] },
      onChange: vi.fn(),
      counts: kindCounts([{ kind: 'garden' }])
    });
    expect(screen.queryByText('Lines & points')).toBeNull();
  });
});

describe('MapFeatureList', () => {
  const areas = [{ id: 'f1', name: 'Home Pasture' }];

  it('groups by kind with lengths, water details and the Area it belongs to', () => {
    render(MapFeatureList, {
      features: [well, fence],
      areas,
      canEdit: false,
      onSave: vi.fn(),
      onDelete: vi.fn()
    });
    const list = screen.getByTestId('map-feature-list');
    const headings = within(list)
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent?.trim());
    expect(headings).toEqual(['Fences', expect.stringMatching(/Water sources$/)]);
    expect(within(list).getByText('Pasture fence · 283 ft')).toBeInTheDocument();
    expect(within(list).getByText('Barn well · Well, 12 gal/min')).toBeInTheDocument();
    expect(within(list).getByText('Home Pasture')).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /Edit/ })).toBeNull();
  });

  it('edits a water source and sends typed details', async () => {
    const onSave = vi.fn(async () => {});
    render(MapFeatureList, {
      features: [well],
      areas,
      canEdit: true,
      onSave,
      onDelete: vi.fn()
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Barn well' }));
    const form = screen.getByRole('form', { name: 'Edit water source' });
    await fireEvent.input(within(form).getByLabelText('Name'), {
      target: { value: 'House well' }
    });
    await fireEvent.change(within(form).getByLabelText('Where the water comes from'), {
      target: { value: 'municipal' }
    });
    await fireEvent.input(within(form).getByLabelText(/Flow rate/), { target: { value: '' } });
    await fireEvent.change(within(form).getByLabelText(/Belongs to/), {
      target: { value: 'f1' }
    });
    await fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('mf_well', {
      name: 'House well',
      fieldId: 'f1',
      details: { source: 'municipal' }
    });
  });

  it('shows a plain error for a bad flow rate and does not save', async () => {
    const onSave = vi.fn(async () => {});
    render(MapFeatureList, { features: [well], areas, canEdit: true, onSave, onDelete: vi.fn() });
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Barn well' }));
    const form = screen.getByRole('form', { name: 'Edit water source' });
    await fireEvent.input(within(form).getByLabelText(/Flow rate/), { target: { value: '-4' } });
    await fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(within(form).getByRole('alert').textContent).toMatch(/Flow rate should be a number/);
  });

  it('removes after confirming', async () => {
    const onDelete = vi.fn(async () => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(MapFeatureList, { features: [fence], areas, canEdit: true, onSave: vi.fn(), onDelete });
    await fireEvent.click(screen.getByRole('button', { name: 'Remove Pasture fence' }));
    expect(onDelete).toHaveBeenCalledWith('mf_fence');
  });
});

describe('FarmMapFigure lines and points', () => {
  const field = {
    id: 'f1',
    name: 'Home Pasture',
    kind: 'pasture' as const,
    geometryGeojson: JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [-77.55, 39.1],
          [-77.549, 39.1],
          [-77.549, 39.101],
          [-77.55, 39.101],
          [-77.55, 39.1]
        ]
      ]
    })
  };

  it('draws each line and point with a legend entry', () => {
    render(FarmMapFigure, { fields: [field], blocks: [], features: [fence, well] });
    const fig = screen.getByTestId('farm-map-figure');
    expect(fig.querySelectorAll('polyline[data-feature-kind="fence"]')).toHaveLength(1);
    expect(fig.querySelectorAll('g[data-feature-kind="water_source"]')).toHaveLength(1);
    expect(fig.querySelector('[data-legend-feature="fence"]')?.textContent).toMatch(/Fence/);
    expect(fig.querySelector('[data-legend-feature="water_source"]')?.textContent).toMatch(
      /Water source/
    );
  });

  it('says why lines and points are missing on a sketched farm', () => {
    render(FarmMapFigure, {
      fields: [{ id: 'g', name: 'Garden', kind: 'garden' as const, widthFt: 30, lengthFt: 40 }],
      blocks: [],
      features: [well]
    });
    expect(screen.getByText(/show once your Areas are drawn on the map/)).toBeInTheDocument();
  });
});
