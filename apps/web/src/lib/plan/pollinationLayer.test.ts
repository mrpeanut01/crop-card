import { describe, expect, it } from 'vitest';
import type { PlanInput, SeedRequest, Assignment } from '$lib/layout/engine';
import type { BlockWithPlantings } from '$lib/db/blocks';
import type { CropPlugin } from '$lib/plugins/schemas';
import {
  buildPollinationLayer,
  computePollinationConstraints,
  renderPollinationPromptSection
} from './pollinationLayer';

function squareAt(lat: number, lon: number, sideDeg = 0.0005): string {
  const half = sideDeg / 2;
  return JSON.stringify({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [lon - half, lat - half],
          [lon + half, lat - half],
          [lon + half, lat + half],
          [lon - half, lat + half],
          [lon - half, lat - half]
        ]
      ]
    }
  });
}

function fakeBlock(
  id: string,
  name: string,
  opts: { geom?: string | null; acres?: number } = {}
): BlockWithPlantings {
  return {
    id,
    fieldId: 'f1',
    name,
    blockLabel: name,
    acres: opts.acres ?? 0.25,
    geometryGeojson: opts.geom === null ? null : opts.geom,
    sunExposure: 'full',
    eastWestIndex: null,
    northSouthIndex: null,
    axesLocked: false,
    plantings: []
  } as unknown as BlockWithPlantings;
}

function fakeCornPlugin(id: string): CropPlugin {
  return {
    pluginId: id,
    type: 'crop',
    schemaVersion: '1.0.0',
    displayName: id,
    cropFamily: 'corn'
  } as unknown as CropPlugin;
}

function fakeSquashPlugin(id: string): CropPlugin {
  return {
    pluginId: id,
    type: 'crop',
    schemaVersion: '1.0.0',
    displayName: id,
    cropFamily: 'cucurbit'
  } as unknown as CropPlugin;
}

function fakeSeed(stockItemId: string, cropPluginId: string, name: string): SeedRequest {
  return {
    stockItemId,
    cropPluginId,
    varietyDisplayName: name,
    quantityPlants: 100
  };
}

function fakePlanInput(opts: {
  seeds: SeedRequest[];
  blocks: BlockWithPlantings[];
  pluginIndex: Record<string, CropPlugin>;
}): PlanInput {
  return {
    seeds: opts.seeds,
    blocks: opts.blocks,
    axes: opts.blocks.map((b) => ({ blockId: b.id, east: null, north: null })),
    existingCrops: [],
    pluginIndex: opts.pluginIndex,
    companions: {}
  };
}

describe('buildPollinationLayer', () => {
  it('returns no pairs when no varieties cross', () => {
    const corn = fakeCornPlugin('corn-bantam-sweet');
    const zucchini = fakeSquashPlugin('zucchini-black-beauty');
    const input = fakePlanInput({
      seeds: [
        fakeSeed('s1', 'corn-bantam-sweet', 'Bantam'),
        fakeSeed('s2', 'zucchini-black-beauty', 'Zucchini')
      ],
      blocks: [fakeBlock('b1', 'Block A'), fakeBlock('b2', 'Block B')],
      pluginIndex: { 'corn-bantam-sweet': corn, 'zucchini-black-beauty': zucchini }
    });
    const layer = buildPollinationLayer(input);
    expect(layer.pairs).toEqual([]);
  });

  it('identifies a corn-corn pair with the 250ft isolation default', () => {
    const c1 = fakeCornPlugin('corn-bantam-sweet');
    const c2 = fakeCornPlugin('corn-bloody-butcher');
    const input = fakePlanInput({
      seeds: [
        fakeSeed('s1', 'corn-bantam-sweet', 'Bantam Sweet'),
        fakeSeed('s2', 'corn-bloody-butcher', 'Bloody Butcher')
      ],
      blocks: [
        fakeBlock('b1', 'Block A', { geom: squareAt(39.0, -77.6) }),
        fakeBlock('b2', 'Block B', { geom: squareAt(39.001, -77.6) }) // ~365ft apart
      ],
      pluginIndex: { 'corn-bantam-sweet': c1, 'corn-bloody-butcher': c2 }
    });
    const layer = buildPollinationLayer(input);
    expect(layer.pairs).toHaveLength(1);
    expect(layer.pairs[0].pair).toEqual(['s1', 's2']);
    expect(layer.pairs[0].requiredIsolationFeet).toBe(250);
    expect(layer.pairs[0].staggerDays).toBe(14);
  });

  it('tracks blocks missing geometry', () => {
    const c1 = fakeCornPlugin('corn-bantam-sweet');
    const c2 = fakeCornPlugin('corn-bloody-butcher');
    const input = fakePlanInput({
      seeds: [
        fakeSeed('s1', 'corn-bantam-sweet', 'Bantam Sweet'),
        fakeSeed('s2', 'corn-bloody-butcher', 'Bloody Butcher')
      ],
      blocks: [
        fakeBlock('b1', 'Block A', { geom: squareAt(39, -77.6) }),
        fakeBlock('b2', 'Block B', { geom: null })
      ],
      pluginIndex: { 'corn-bantam-sweet': c1, 'corn-bloody-butcher': c2 }
    });
    const layer = buildPollinationLayer(input);
    expect(layer.geometryMissingBlockIds).toEqual(['b2']);
  });
});

describe('computePollinationConstraints', () => {
  const c1 = fakeCornPlugin('corn-bantam-sweet');
  const c2 = fakeCornPlugin('corn-bloody-butcher');

  function setup(blockGap: number) {
    const input = fakePlanInput({
      seeds: [
        fakeSeed('s1', 'corn-bantam-sweet', 'Bantam Sweet'),
        fakeSeed('s2', 'corn-bloody-butcher', 'Bloody Butcher')
      ],
      blocks: [
        fakeBlock('b1', 'Block A', { geom: squareAt(39.0, -77.6) }),
        fakeBlock('b2', 'Block B', { geom: squareAt(39.0 + blockGap, -77.6) })
      ],
      pluginIndex: { 'corn-bantam-sweet': c1, 'corn-bloody-butcher': c2 }
    });
    const layer = buildPollinationLayer(input);
    const assignments: Assignment[] = [
      {
        stockItemId: 's1',
        cropPluginId: 'corn-bantam-sweet',
        varietyDisplayName: 'Bantam Sweet',
        blockId: 'b1',
        plants: 100,
        score: 0
      },
      {
        stockItemId: 's2',
        cropPluginId: 'corn-bloody-butcher',
        varietyDisplayName: 'Bloody Butcher',
        blockId: 'b2',
        plants: 100,
        score: 0
      }
    ];
    return { input, layer, assignments };
  }

  it('flags isolated-spatially when distance >= 250ft', () => {
    // 0.001 deg lat at 39N is ~365ft, comfortably over the 250ft default.
    const { input, layer, assignments } = setup(0.001);
    const constraints = computePollinationConstraints(assignments, input, layer);
    expect(constraints).toHaveLength(1);
    expect(constraints[0].kind).toBe('isolated-spatially');
    expect(constraints[0].distanceFt).toBeGreaterThan(360);
  });

  it('flags must-stagger when distance < 250ft', () => {
    // 0.0003 deg lat at 39N is ~109ft — well under 250ft.
    const { input, layer, assignments } = setup(0.0003);
    const constraints = computePollinationConstraints(assignments, input, layer);
    expect(constraints).toHaveLength(1);
    expect(constraints[0].kind).toBe('must-stagger');
    expect(constraints[0].staggerDays).toBe(14);
    expect(constraints[0].note).toMatch(/≥14 d/);
  });

  it('flags geometry-missing when one block lacks geometry', () => {
    const input = fakePlanInput({
      seeds: [
        fakeSeed('s1', 'corn-bantam-sweet', 'Bantam Sweet'),
        fakeSeed('s2', 'corn-bloody-butcher', 'Bloody Butcher')
      ],
      blocks: [
        fakeBlock('b1', 'Block A', { geom: squareAt(39, -77.6) }),
        fakeBlock('b2', 'Block B', { geom: null })
      ],
      pluginIndex: { 'corn-bantam-sweet': c1, 'corn-bloody-butcher': c2 }
    });
    const layer = buildPollinationLayer(input);
    const assignments: Assignment[] = [
      {
        stockItemId: 's1',
        cropPluginId: 'corn-bantam-sweet',
        varietyDisplayName: 'Bantam Sweet',
        blockId: 'b1',
        plants: 100,
        score: 0
      },
      {
        stockItemId: 's2',
        cropPluginId: 'corn-bloody-butcher',
        varietyDisplayName: 'Bloody Butcher',
        blockId: 'b2',
        plants: 100,
        score: 0
      }
    ];
    const constraints = computePollinationConstraints(assignments, input, layer);
    expect(constraints[0].kind).toBe('geometry-missing');
    expect(constraints[0].distanceFt).toBeNull();
  });

  it('handles same-block placement as worst case (distance=0 → must-stagger)', () => {
    const input = fakePlanInput({
      seeds: [
        fakeSeed('s1', 'corn-bantam-sweet', 'Bantam'),
        fakeSeed('s2', 'corn-bloody-butcher', 'Bloody Butcher')
      ],
      blocks: [fakeBlock('b1', 'Block A', { geom: squareAt(39, -77.6) })],
      pluginIndex: { 'corn-bantam-sweet': c1, 'corn-bloody-butcher': c2 }
    });
    const layer = buildPollinationLayer(input);
    const assignments: Assignment[] = [
      {
        stockItemId: 's1',
        cropPluginId: 'corn-bantam-sweet',
        varietyDisplayName: 'Bantam',
        blockId: 'b1',
        plants: 50,
        score: 0
      },
      {
        stockItemId: 's2',
        cropPluginId: 'corn-bloody-butcher',
        varietyDisplayName: 'Bloody Butcher',
        blockId: 'b1',
        plants: 50,
        score: 0
      }
    ];
    const constraints = computePollinationConstraints(assignments, input, layer);
    expect(constraints).toHaveLength(1);
    expect(constraints[0].kind).toBe('must-stagger');
    expect(constraints[0].distanceFt).toBe(0);
  });
});

describe('renderPollinationPromptSection', () => {
  it('emits nothing when no pairs cross', () => {
    const corn = fakeCornPlugin('corn-bantam-sweet');
    const input = fakePlanInput({
      seeds: [fakeSeed('s1', 'corn-bantam-sweet', 'Bantam')],
      blocks: [fakeBlock('b1', 'Block A')],
      pluginIndex: { 'corn-bantam-sweet': corn }
    });
    const layer = buildPollinationLayer(input);
    expect(renderPollinationPromptSection(layer, input)).toBe('');
  });

  it('renders pair, distance grid, and maximize-spacing instruction', () => {
    const c1 = fakeCornPlugin('corn-bantam-sweet');
    const c2 = fakeCornPlugin('corn-bloody-butcher');
    const input = fakePlanInput({
      seeds: [
        fakeSeed('s1', 'corn-bantam-sweet', 'Bantam'),
        fakeSeed('s2', 'corn-bloody-butcher', 'Bloody Butcher')
      ],
      blocks: [
        fakeBlock('b1', 'Block A', { geom: squareAt(39, -77.6) }),
        fakeBlock('b2', 'Block B', { geom: squareAt(39.001, -77.6) })
      ],
      pluginIndex: { 'corn-bantam-sweet': c1, 'corn-bloody-butcher': c2 }
    });
    const layer = buildPollinationLayer(input);
    const rendered = renderPollinationPromptSection(layer, input);
    expect(rendered).toMatch(/CROSS-POLLINATION/);
    expect(rendered).toMatch(/Bantam × Bloody Butcher/);
    expect(rendered).toMatch(/Block A ↔ Block B/);
    expect(rendered).toMatch(/MAXIMIZES distance/);
  });

  it('flags geometry-missing blocks in the prompt', () => {
    const c1 = fakeCornPlugin('corn-bantam-sweet');
    const c2 = fakeCornPlugin('corn-bloody-butcher');
    const input = fakePlanInput({
      seeds: [
        fakeSeed('s1', 'corn-bantam-sweet', 'Bantam'),
        fakeSeed('s2', 'corn-bloody-butcher', 'Bloody Butcher')
      ],
      blocks: [
        fakeBlock('b1', 'Block A', { geom: squareAt(39, -77.6) }),
        fakeBlock('b2', 'No-Geom Block', { geom: null })
      ],
      pluginIndex: { 'corn-bantam-sweet': c1, 'corn-bloody-butcher': c2 }
    });
    const layer = buildPollinationLayer(input);
    const rendered = renderPollinationPromptSection(layer, input);
    expect(rendered).toMatch(/no recorded geometry/);
    expect(rendered).toMatch(/No-Geom Block/);
  });
});
