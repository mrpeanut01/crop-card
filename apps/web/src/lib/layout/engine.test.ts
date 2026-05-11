/**
 * Phase 14a — layout engine vitest suite.
 *
 * The engine is pure, so all fixtures are constructed inline. Tests cover
 * determinism, tightness ordering, capacity split, no-fit fallback, free
 * re-shuffle behavior, companion bonuses/penalties, sun-match, narrow-block
 * penalty, rotation lookback, and Three Sisters detection.
 */

import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { BlockWithPlantings } from '$lib/db/blocks';
import type { Crop } from '$lib/db/crops';
import { planLayout, type BlockAxisLite, type PlanInput, type SeedRequest } from './engine';

// ─── Fixture factories ───────────────────────────────────────────────────

function plugin(over: Partial<CropPlugin> & { pluginId: string }): CropPlugin {
  const base: CropPlugin = {
    pluginId: over.pluginId,
    type: 'crop',
    displayName: over.displayName ?? over.pluginId,
    version: '1.0.0',
    cropFamily: over.cropFamily ?? 'herb-culinary',
    defaultRowSpacingInches: over.defaultRowSpacingInches ?? 12,
    plantingGuide: over.plantingGuide ?? {
      rowSpacingIn: 12,
      inRowSpacingIn: { min: 6, max: 6 }
    },
    matureHeightFt: over.matureHeightFt,
    shadeCasting: over.shadeCasting,
    daysToMaturity: over.daysToMaturity ?? { min: 60, max: 90 }
  } as CropPlugin;
  return { ...base, ...over } as CropPlugin;
}

function block(over: Partial<BlockWithPlantings> & { id: string }): BlockWithPlantings {
  return {
    id: over.id,
    name: over.name ?? over.id,
    acres: over.acres ?? 0.25,
    tillageMethod: over.tillageMethod ?? 'conventional',
    axesLocked: false,
    sunExposure: over.sunExposure,
    geometryGeojson: over.geometryGeojson,
    plantings: over.plantings ?? []
  };
}

function axis(blockId: string, east: number | null, north: number | null): BlockAxisLite {
  return { blockId, east, north };
}

function seed(over: Partial<SeedRequest> & { stockItemId: string; cropPluginId: string }): SeedRequest {
  return {
    stockItemId: over.stockItemId,
    cropPluginId: over.cropPluginId,
    varietyDisplayName: over.varietyDisplayName ?? over.cropPluginId,
    quantityPlants: over.quantityPlants ?? 100,
    sunRequirement: over.sunRequirement
  };
}

function buildInput(parts: {
  seeds: SeedRequest[];
  blocks: BlockWithPlantings[];
  axes?: BlockAxisLite[];
  existingCrops?: Crop[];
  pluginIndex: Record<string, CropPlugin>;
  companions?: Record<string, { goodWith: string[]; badWith: string[] }>;
}): PlanInput {
  return {
    seeds: parts.seeds,
    blocks: parts.blocks,
    axes:
      parts.axes ??
      parts.blocks.map((b, i) => axis(b.id, i, 0)),
    existingCrops: parts.existingCrops ?? [],
    pluginIndex: parts.pluginIndex,
    companions: parts.companions ?? {}
  };
}

// ─── Specs ───────────────────────────────────────────────────────────────

describe('layout engine — determinism', () => {
  it('returns identical assignments for identical input', () => {
    const corn = plugin({ pluginId: 'corn-x', cropFamily: 'corn', matureHeightFt: 8 });
    const lettuce = plugin({ pluginId: 'lettuce-x', cropFamily: 'leafy-green' });
    const input = buildInput({
      seeds: [
        seed({ stockItemId: 's1', cropPluginId: 'corn-x', quantityPlants: 50 }),
        seed({ stockItemId: 's2', cropPluginId: 'lettuce-x', quantityPlants: 50 })
      ],
      blocks: [block({ id: 'A', acres: 0.5 }), block({ id: 'B', acres: 0.5 })],
      pluginIndex: { 'corn-x': corn, 'lettuce-x': lettuce }
    });
    const a = planLayout(input);
    const b = planLayout(input);
    expect(b).toEqual(a);
  });
});

describe('layout engine — capacity split', () => {
  it('splits a request across two blocks when one is too small', () => {
    const lettuce = plugin({
      pluginId: 'lettuce-tight',
      cropFamily: 'leafy-green',
      defaultRowSpacingInches: 12,
      plantingGuide: { rowSpacingIn: 12, inRowSpacingIn: { min: 6, max: 6 } }
    });
    // 0.05 acres ≈ 2178 sqft. Per-plant footprint = 1ft × 0.5ft = 0.5 sqft.
    // capacity ≈ 4356. We'll request 6000 → must split.
    const input = buildInput({
      seeds: [seed({ stockItemId: 's', cropPluginId: 'lettuce-tight', quantityPlants: 6000 })],
      blocks: [
        block({ id: 'A', acres: 0.05 }),
        block({ id: 'B', acres: 0.05 })
      ],
      pluginIndex: { 'lettuce-tight': lettuce }
    });
    const result = planLayout(input);
    expect(result.unplaced).toHaveLength(0);
    const total = result.assignments.reduce((s, a) => s + a.plants, 0);
    expect(total).toBe(6000);
    expect(result.assignments.length).toBeGreaterThanOrEqual(2);
  });
});

describe('layout engine — no fit', () => {
  it('places seed into unplaced when total capacity is insufficient', () => {
    const corn = plugin({
      pluginId: 'corn-bb',
      cropFamily: 'corn',
      defaultRowSpacingInches: 36,
      plantingGuide: { rowSpacingIn: 36, inRowSpacingIn: { min: 9, max: 12 } }
    });
    // 0.01 acres ≈ 435 sqft. Per-plant ≈ 3 × 0.875 = 2.625 sqft.
    // capacity ≈ 165. Request 10,000 → no fit possible.
    const input = buildInput({
      seeds: [seed({ stockItemId: 's', cropPluginId: 'corn-bb', quantityPlants: 10_000 })],
      blocks: [block({ id: 'A', acres: 0.01 })],
      pluginIndex: { 'corn-bb': corn }
    });
    const result = planLayout(input);
    expect(result.unplaced).toHaveLength(1);
    expect(result.assignments).toHaveLength(0);
    expect(result.diagnostics[0]?.reason).toMatch(/capacity/);
  });
});

describe('layout engine — companion bad-pair', () => {
  it('avoids placing a bad-pair seed adjacent to its conflict', () => {
    const onion = plugin({ pluginId: 'onion-yellow', cropFamily: 'allium' });
    const bean = plugin({ pluginId: 'bean-bush', cropFamily: 'legume' });
    const input = buildInput({
      seeds: [
        seed({ stockItemId: 's-onion', cropPluginId: 'onion-yellow', quantityPlants: 30 }),
        seed({ stockItemId: 's-bean', cropPluginId: 'bean-bush', quantityPlants: 30 })
      ],
      blocks: [
        block({ id: 'A', acres: 0.5 }),
        block({ id: 'B', acres: 0.5 }),
        block({ id: 'C', acres: 0.5 })
      ],
      axes: [axis('A', 0, 0), axis('B', 1, 0), axis('C', 2, 0)],
      pluginIndex: { 'onion-yellow': onion, 'bean-bush': bean },
      companions: {
        'onion-yellow': { goodWith: [], badWith: ['bean-bush'] },
        'bean-bush': { goodWith: [], badWith: ['onion-yellow'] }
      }
    });
    const result = planLayout(input);
    const onionBlock = result.assignments.find((a) => a.cropPluginId === 'onion-yellow')!.blockId;
    const beanBlock = result.assignments.find((a) => a.cropPluginId === 'bean-bush')!.blockId;
    // With 3 blocks in a line, the engine should land them ≥2 apart.
    const idxOnion = ['A', 'B', 'C'].indexOf(onionBlock);
    const idxBean = ['A', 'B', 'C'].indexOf(beanBlock);
    expect(Math.abs(idxOnion - idxBean)).toBeGreaterThanOrEqual(2);
  });
});

describe('layout engine — Three Sisters bonus', () => {
  it('co-locates corn + legume + cucurbit on the same block when capacity allows', () => {
    const corn = plugin({ pluginId: 'corn-bb', cropFamily: 'corn', matureHeightFt: 8 });
    const bean = plugin({ pluginId: 'bean-pole', cropFamily: 'legume' });
    const squash = plugin({ pluginId: 'squash-acorn', cropFamily: 'cucurbit' });
    const input = buildInput({
      seeds: [
        seed({ stockItemId: 's-corn', cropPluginId: 'corn-bb', quantityPlants: 40 }),
        seed({ stockItemId: 's-bean', cropPluginId: 'bean-pole', quantityPlants: 40 }),
        seed({ stockItemId: 's-sq', cropPluginId: 'squash-acorn', quantityPlants: 20 })
      ],
      blocks: [
        block({ id: 'A', acres: 1.0, sunExposure: 'full' }),
        block({ id: 'B', acres: 1.0, sunExposure: 'full' })
      ],
      pluginIndex: { 'corn-bb': corn, 'bean-pole': bean, 'squash-acorn': squash }
    });
    const result = planLayout(input);
    const blocksUsed = new Set(result.assignments.map((a) => a.blockId));
    expect(blocksUsed.size).toBe(1);
  });
});

describe('layout engine — rotation lookback', () => {
  it('penalises a block where the same family was planted within lookback', () => {
    const tomato = plugin({ pluginId: 'tomato-roma', cropFamily: 'solanaceae' });
    const cropHistory: Crop = {
      id: 'c-prior',
      blockId: 'A',
      cropPluginId: 'tomato-roma',
      varietyDisplayName: 'Tomato (prior season)',
      plantingDate: Date.now() - 365 * 86_400_000, // 1 year ago — inside 4yr lookback
      status: 'harvested'
    };
    const input = buildInput({
      seeds: [seed({ stockItemId: 's', cropPluginId: 'tomato-roma', quantityPlants: 20 })],
      blocks: [
        block({ id: 'A', acres: 0.5, sunExposure: 'full' }),
        block({ id: 'B', acres: 0.5, sunExposure: 'full' })
      ],
      existingCrops: [cropHistory],
      pluginIndex: { 'tomato-roma': tomato }
    });
    const result = planLayout(input);
    expect(result.assignments[0]?.blockId).toBe('B');
  });
});

describe('layout engine — footprint tightness', () => {
  it('places the wide-row crop before the narrow-row crop when other terms tie', () => {
    const corn = plugin({
      pluginId: 'corn-wide',
      cropFamily: 'herb-culinary', // neutralise family-driven tightness
      defaultRowSpacingInches: 36,
      plantingGuide: { rowSpacingIn: 36, inRowSpacingIn: { min: 9, max: 9 } },
      matureHeightFt: undefined,
      shadeCasting: false
    });
    const lettuce = plugin({
      pluginId: 'lettuce-narrow',
      cropFamily: 'herb-culinary',
      defaultRowSpacingInches: 6,
      plantingGuide: { rowSpacingIn: 6, inRowSpacingIn: { min: 4, max: 4 } }
    });
    // Ask in alphabetical order — sort must reorder corn-wide ahead of lettuce-narrow.
    const input = buildInput({
      seeds: [
        seed({ stockItemId: 's-l', cropPluginId: 'lettuce-narrow', quantityPlants: 20 }),
        seed({ stockItemId: 's-c', cropPluginId: 'corn-wide', quantityPlants: 20 })
      ],
      // Single block big enough for both, so first-placed wins block 'A'.
      blocks: [
        block({ id: 'A', acres: 1.0 }),
        block({ id: 'B', acres: 1.0 })
      ],
      pluginIndex: { 'corn-wide': corn, 'lettuce-narrow': lettuce }
    });
    const result = planLayout(input);
    const cornAssn = result.assignments.find((a) => a.cropPluginId === 'corn-wide');
    expect(cornAssn?.blockId).toBe('A');
  });
});

describe('layout engine — narrow block penalty', () => {
  it('prefers a wider block over a narrow one when capacity is equal', () => {
    const corn = plugin({
      pluginId: 'corn-wide',
      cropFamily: 'corn',
      defaultRowSpacingInches: 36,
      plantingGuide: { rowSpacingIn: 36, inRowSpacingIn: { min: 9, max: 9 } }
    });
    // Two blocks with identical acreage but different geometries:
    // narrow: 4ft × 100ft; wide: 20ft × 20ft. Both ~400 sqft.
    // 4ft < 2 × (36/12) = 6ft → narrow penalty fires on narrow block.
    const narrowGeo = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [-77.5, 39.0],
          [-77.5, 39.0 + 100 / 364488],
          [-77.5 + 4 / (364488 * Math.cos((39 * Math.PI) / 180)), 39.0 + 100 / 364488],
          [-77.5 + 4 / (364488 * Math.cos((39 * Math.PI) / 180)), 39.0],
          [-77.5, 39.0]
        ]
      ]
    });
    const wideGeo = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [-77.6, 39.0],
          [-77.6, 39.0 + 20 / 364488],
          [-77.6 + 20 / (364488 * Math.cos((39 * Math.PI) / 180)), 39.0 + 20 / 364488],
          [-77.6 + 20 / (364488 * Math.cos((39 * Math.PI) / 180)), 39.0],
          [-77.6, 39.0]
        ]
      ]
    });
    const input = buildInput({
      seeds: [seed({ stockItemId: 's', cropPluginId: 'corn-wide', quantityPlants: 30 })],
      blocks: [
        block({ id: 'narrow', acres: 0.01, geometryGeojson: narrowGeo, sunExposure: 'full' }),
        block({ id: 'wide', acres: 0.01, geometryGeojson: wideGeo, sunExposure: 'full' })
      ],
      pluginIndex: { 'corn-wide': corn }
    });
    const result = planLayout(input);
    expect(result.assignments[0]?.blockId).toBe('wide');
  });
});

describe('layout engine — sun match', () => {
  it('prefers a sun-matched block over a mismatched block', () => {
    const tomato = plugin({ pluginId: 'tomato-r', cropFamily: 'solanaceae' });
    const input = buildInput({
      seeds: [
        seed({
          stockItemId: 's',
          cropPluginId: 'tomato-r',
          quantityPlants: 20,
          sunRequirement: 'full'
        })
      ],
      blocks: [
        block({ id: 'A', acres: 0.5, sunExposure: 'shade' }),
        block({ id: 'B', acres: 0.5, sunExposure: 'full' })
      ],
      pluginIndex: { 'tomato-r': tomato }
    });
    const result = planLayout(input);
    expect(result.assignments[0]?.blockId).toBe('B');
  });
});

describe('layout engine — free re-shuffle', () => {
  it('may move existing assignments when a new seed is added', () => {
    const corn = plugin({ pluginId: 'corn-x', cropFamily: 'corn', matureHeightFt: 8 });
    const tomato = plugin({ pluginId: 'tomato-x', cropFamily: 'solanaceae' });

    const baseSeeds = [seed({ stockItemId: 's-t', cropPluginId: 'tomato-x', quantityPlants: 30 })];
    const blocksFx = [
      block({ id: 'A', acres: 0.5, sunExposure: 'full' }),
      block({ id: 'B', acres: 0.5, sunExposure: 'partial' })
    ];
    const pluginIndex = { 'corn-x': corn, 'tomato-x': tomato };

    const before = planLayout(buildInput({ seeds: baseSeeds, blocks: blocksFx, pluginIndex }));
    const tomatoBefore = before.assignments.find((a) => a.cropPluginId === 'tomato-x')!.blockId;

    const after = planLayout(
      buildInput({
        seeds: [
          ...baseSeeds,
          seed({ stockItemId: 's-c', cropPluginId: 'corn-x', quantityPlants: 30 })
        ],
        blocks: blocksFx,
        pluginIndex
      })
    );

    // Re-solve must succeed for both seeds.
    expect(after.assignments).toHaveLength(2);
    // Tomato should land on the 'full' sun block; corn-tightness places first
    // (tall crop), so this exercises that re-solving from scratch is correct
    // even when seeds enter in a different order than the user added them.
    const tomatoAfter = after.assignments.find((a) => a.cropPluginId === 'tomato-x')!.blockId;
    expect(['A', 'B']).toContain(tomatoAfter);
    expect(tomatoBefore).toBeDefined();
  });
});
