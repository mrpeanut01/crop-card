import { describe, expect, it, vi } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { PluginRegistry } from '$lib/plugins/registry';

vi.mock('$lib/db/blocks', () => ({
  listBlocks: () => [
    { id: 'bed', name: 'Bed', acres: 100 / 43_560, widthFt: 4, lengthFt: 25, plantings: [] }
  ]
}));
vi.mock('$lib/db/crops', () => ({ listCrops: () => [] }));
vi.mock('$lib/db/fields', () => ({ listFields: () => [] }));

import { buildAllocationInput, withAreaSqFt } from './allocationInput';

const RYE = {
  pluginId: 'rye',
  type: 'crop',
  displayName: 'Rye',
  cropFamily: 'cover-grass',
  plantingGuide: { seedingRate: { broadcastLbsPerAcre: { min: 90, max: 160 } } }
} as unknown as CropPlugin;
const BEAN = {
  pluginId: 'bean',
  type: 'crop',
  displayName: 'Bean',
  cropFamily: 'legume',
  plantingGuide: { rowSpacingIn: 18, inRowSpacingIn: { min: 2, max: 4 } }
} as unknown as CropPlugin;

const registry = { all: () => [{ plugin: RYE }, { plugin: BEAN }] } as unknown as PluginRegistry;

describe('buildAllocationInput for crops sown by area (#555)', () => {
  it('plans an area crop in square feet and marks it', () => {
    const r = buildAllocationInput(
      registry,
      [
        { stockItemId: 's1', cropPluginId: 'rye', varietyDisplayName: 'Rye', areaSqFt: 60.2 },
        { stockItemId: 's2', cropPluginId: 'bean', varietyDisplayName: 'Bean', quantityPlants: 40 }
      ],
      ['bed']
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.planInput.seeds[0]).toMatchObject({ quantityPlants: 61, byArea: true });
    expect(r.planInput.seeds[0].fillToCapacity).toBeUndefined();
    expect(r.planInput.seeds[1]).toMatchObject({ quantityPlants: 40 });
    expect(r.planInput.seeds[1].byArea).toBeUndefined();
  });

  it('sizes an area crop to the bed when no area is sent, never from a plant count', () => {
    const r = buildAllocationInput(
      registry,
      [{ stockItemId: 's1', cropPluginId: 'rye', varietyDisplayName: 'Rye', quantityPlants: 9000 }],
      ['bed']
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.planInput.seeds[0]).toMatchObject({
      fillToCapacity: true,
      byArea: true,
      // The field model's usable ground (85% of the 100 sq ft), in square feet.
      quantityPlants: 85
    });
  });

  it('labels assignments of area crops with their square feet', () => {
    const out = withAreaSqFt(
      [
        { cropPluginId: 'rye', plants: 80 },
        { cropPluginId: 'bean', plants: 40 }
      ],
      { rye: RYE, bean: BEAN }
    );
    expect(out[0]).toEqual({ cropPluginId: 'rye', plants: 80, areaSqFt: 80 });
    expect(out[1]).toEqual({ cropPluginId: 'bean', plants: 40 });
  });
});
