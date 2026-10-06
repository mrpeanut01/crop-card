import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { BlockWithPlantings } from '$lib/db/blocks';
import type { Crop } from '$lib/db/crops';
import {
  bedPlantsFit,
  bedUsableSqft,
  existingBedShare,
  freeBedShare,
  plantsForShare,
  sharedBedBlockIds,
  SHARE_EPSILON
} from './bedSharing';
import { planLayout, type PlanInput, type SeedRequest } from './engine';

function crop(pluginId: string, spacingIn: number, family = 'leafy-green'): CropPlugin {
  return {
    pluginId,
    type: 'crop',
    displayName: pluginId,
    version: '1.0.0',
    cropFamily: family,
    defaultRowSpacingInches: spacingIn,
    plantingGuide: { rowSpacingIn: spacingIn, inRowSpacingIn: { min: spacingIn, max: spacingIn } },
    daysToMaturity: { min: 60, max: 90 }
  } as CropPlugin;
}

function bed(id: string, widthFt = 4, lengthFt = 8): BlockWithPlantings {
  return {
    id,
    name: id,
    acres: (widthFt * lengthFt) / 43_560,
    widthFt,
    lengthFt,
    tillageMethod: 'no-till',
    axesLocked: false,
    sunExposure: 'full',
    fieldId: 'garden',
    plantings: []
  };
}

function field(id: string, acres = 0.25): BlockWithPlantings {
  return {
    id,
    name: id,
    acres,
    tillageMethod: 'conventional',
    axesLocked: false,
    sunExposure: 'full',
    fieldId: 'north',
    plantings: []
  };
}

const lettuce = crop('lettuce', 12);
const tomato = crop('tomato', 24, 'solanaceae');
const pepper = crop('pepper', 18, 'solanaceae');
const bean = crop('bean', 6, 'legume');
const index = { lettuce, tomato, pepper, bean };

function seed(id: string, pluginId: string, plants: number, fill = false): SeedRequest {
  return {
    stockItemId: id,
    cropPluginId: pluginId,
    varietyDisplayName: id,
    quantityPlants: plants,
    ...(fill ? { fillToCapacity: true } : {})
  };
}

function input(seeds: SeedRequest[], blocks: BlockWithPlantings[], beds: string[]): PlanInput {
  return {
    seeds,
    blocks,
    axes: blocks.map((b, i) => ({ blockId: b.id, east: i, north: 0 })),
    existingCrops: [],
    pluginIndex: index,
    companions: {},
    bedBlockIds: beds
  };
}

function sharesByBed(result: ReturnType<typeof planLayout>, blocks: BlockWithPlantings[]) {
  const out = new Map<string, number>();
  for (const a of result.assignments) {
    const b = blocks.find((x) => x.id === a.blockId)!;
    out.set(
      a.blockId,
      (out.get(a.blockId) ?? 0) +
        a.plants / bedPlantsFit(b, index[a.cropPluginId as keyof typeof index])
    );
  }
  return out;
}

describe('bed geometry', () => {
  it('uses the typed dimensions with no perimeter buffer', () => {
    expect(bedUsableSqft(bed('b'))).toBe(32);
    expect(bedPlantsFit(bed('b'), lettuce)).toBe(32);
    expect(bedPlantsFit(bed('b'), tomato)).toBe(8);
  });

  it('only treats garden and greenhouse Areas as shared beds', () => {
    const blocks = [
      { id: 'b1', fieldId: 'g' },
      { id: 'b2', fieldId: 'gh' },
      { id: 'f1', fieldId: 'f' },
      { id: 'loose' }
    ];
    const fields = [
      { id: 'g', kind: 'garden' },
      { id: 'gh', kind: 'greenhouse' },
      { id: 'f', kind: 'field' }
    ];
    expect(sharedBedBlockIds(blocks, fields)).toEqual(['b1', 'b2']);
  });

  it('counts existing plantings against the free share', () => {
    const b = bed('b');
    const existing = [
      { blockId: 'b', cropPluginId: 'tomato', status: 'planted', quantityPlanted: 4 },
      { blockId: 'b', cropPluginId: 'lettuce', status: 'harvested', quantityPlanted: 32 }
    ] as unknown as Crop[];
    expect(existingBedShare(b, existing, index)).toBeCloseTo(0.5);
    expect(freeBedShare(b, existing, index)).toBeCloseTo(0.5);
  });

  it('an existing crop sown by area takes its ground, never its old placeholder count (#555)', () => {
    const b = bed('b', 4, 25);
    const rye = {
      pluginId: 'rye',
      type: 'crop',
      displayName: 'rye',
      version: '1.0.0',
      cropFamily: 'cover-grass',
      plantingGuide: { seedingRate: { broadcastLbsPerAcre: { min: 90, max: 160 } } }
    } as unknown as CropPlugin;
    const idx = { ...index, rye };
    const placed = [
      {
        blockId: 'b',
        cropPluginId: 'rye',
        status: 'planned',
        plantCount: 900_000,
        footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 120 }
      }
    ] as unknown as Crop[];
    expect(existingBedShare(b, placed, idx)).toBeCloseTo(40 / 100);
    const sown = [
      {
        blockId: 'b',
        cropPluginId: 'rye',
        status: 'active',
        quantityPlanted: 0.1,
        quantityUnit: 'lb'
      }
    ] as unknown as Crop[];
    expect(existingBedShare(b, sown, idx)).toBeCloseTo(((0.1 / 160) * 43_560) / 100);
    const unknown = [{ blockId: 'b', cropPluginId: 'rye', status: 'active' }] as unknown as Crop[];
    expect(existingBedShare(b, unknown, idx)).toBeCloseTo(0.5);
  });

  it('a fill-to-bed planting saved with its plant count fills the bed', () => {
    const b = bed('b');
    const existing = [
      { blockId: 'b', cropPluginId: 'tomato', status: 'planned', plantCount: 8 }
    ] as unknown as Crop[];
    expect(existingBedShare(b, existing, index)).toBeCloseTo(1);
    expect(freeBedShare(b, existing, index)).toBeCloseTo(0);
  });

  it('prefers the plant count over a seed quantity', () => {
    const b = bed('b');
    const existing = [
      {
        blockId: 'b',
        cropPluginId: 'tomato',
        status: 'planned',
        plantCount: 2,
        quantityPlanted: 40,
        quantityUnit: 'seeds'
      }
    ] as unknown as Crop[];
    expect(existingBedShare(b, existing, index)).toBeCloseTo(0.25);
  });

  it('rounds plants down from a share', () => {
    expect(plantsForShare(0.25, 32)).toBe(8);
    expect(plantsForShare(0.3, 10)).toBe(3);
    expect(plantsForShare(0, 10)).toBe(0);
  });
});

describe('engine packing on shared beds (#440)', () => {
  it('splits one bed between crops instead of giving the first crop all of it', () => {
    const b = bed('bed');
    const result = planLayout(
      input(
        [seed('L', 'lettuce', 1000), seed('T', 'tomato', 1000), seed('P', 'pepper', 1000)],
        [b],
        ['bed']
      )
    );
    expect(new Set(result.assignments.map((a) => a.stockItemId))).toEqual(new Set(['L', 'T', 'P']));
    // Phase 35 (R-11): seed left once the bed is full is reported, with the
    // bed named as full, instead of being dropped.
    for (const u of result.unplaced) {
      const got = result.assignments
        .filter((a) => a.stockItemId === u.stockItemId)
        .reduce((s, a) => s + a.plants, 0);
      expect(got + u.quantityPlants).toBe(1000);
    }
    for (const r of result.leftover) {
      expect(r.blocks).toEqual([{ blockId: 'bed', status: 'full' }]);
    }
    const share = sharesByBed(result, [b]).get('bed')!;
    expect(share).toBeLessThanOrEqual(1 + SHARE_EPSILON);
    expect(share).toBeGreaterThan(0.8);
  });

  it('gives a small request all it asks for and the rest to the others', () => {
    const b = bed('bed');
    const result = planLayout(
      input([seed('T', 'tomato', 2), seed('L', 'lettuce', 1000)], [b], ['bed'])
    );
    const tomatoRow = result.assignments.find((a) => a.stockItemId === 'T')!;
    const lettuceRow = result.assignments.find((a) => a.stockItemId === 'L')!;
    expect(tomatoRow.plants).toBe(2);
    expect(lettuceRow.plants).toBe(24);
  });

  it('spreads uncounted seeds over the beds', () => {
    const beds = [bed('b1'), bed('b2')];
    const result = planLayout(
      input([seed('L', 'lettuce', 64, true), seed('B', 'bean', 256, true)], beds, ['b1', 'b2'])
    );
    const bedsUsed = new Set(result.assignments.map((a) => a.blockId));
    expect(bedsUsed).toEqual(new Set(['b1', 'b2']));
    for (const a of result.assignments) {
      const b = beds.find((x) => x.id === a.blockId)!;
      expect(a.plants).toBe(bedPlantsFit(b, index[a.cropPluginId as keyof typeof index]));
    }
  });

  it('keeps field blocks one crop per block for an uncounted seed', () => {
    const blocks = [field('F1'), field('F2')];
    const result = planLayout(input([seed('L', 'lettuce', 100_000, true)], blocks, []));
    expect(result.assignments).toHaveLength(1);
  });

  it('never packs a bed past its free share', () => {
    const cropIds = ['lettuce', 'tomato', 'pepper', 'bean'] as const;
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            crop: fc.constantFrom(...cropIds),
            plants: fc.integer({ min: 1, max: 400 }),
            fill: fc.boolean()
          }),
          { minLength: 1, maxLength: 8 }
        ),
        fc.array(
          fc.record({ w: fc.integer({ min: 2, max: 6 }), l: fc.integer({ min: 4, max: 20 }) }),
          { minLength: 1, maxLength: 3 }
        ),
        (seedSpecs, bedSpecs) => {
          const beds = bedSpecs.map((d, i) => bed(`b${i}`, d.w, d.l));
          const seeds = seedSpecs.map((sp, i) => seed(`s${i}`, sp.crop, sp.plants, sp.fill));
          const result = planLayout(
            input(
              seeds,
              beds,
              beds.map((b) => b.id)
            )
          );
          for (const share of sharesByBed(result, beds).values()) {
            expect(share).toBeLessThanOrEqual(1 + SHARE_EPSILON);
          }
          for (const s of seeds) {
            if (s.fillToCapacity) continue;
            const placed = result.assignments
              .filter((a) => a.stockItemId === s.stockItemId)
              .reduce((n, a) => n + a.plants, 0);
            expect(placed).toBeLessThanOrEqual(s.quantityPlants);
          }
          const again = planLayout(
            input(
              seeds,
              beds,
              beds.map((b) => b.id)
            )
          );
          expect(again).toEqual(result);
        }
      ),
      { numRuns: 150 }
    );
  });
});
