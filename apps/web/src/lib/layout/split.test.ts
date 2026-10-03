import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { BlockWithPlantings } from '$lib/db/blocks';
import type { Crop } from '$lib/db/crops';
import { planLayout, type Assignment, type PlanInput, type SeedRequest } from './engine';
import { blockRuleOut, blocksWithRoomForLeftover, leftoverReports, roomFor } from './split';
import { bedPlantsFit } from './bedSharing';
import { plantsFitUsable } from './sufficiency';

const NOW = Date.UTC(2026, 9, 2);

function plugin(id: string, family = 'leafy-green', over: Partial<CropPlugin> = {}): CropPlugin {
  return {
    pluginId: id,
    type: 'crop',
    displayName: id,
    version: '1.0.0',
    cropFamily: family,
    defaultRowSpacingInches: 12,
    plantingGuide: { rowSpacingIn: 12, inRowSpacingIn: { min: 12, max: 12 } },
    daysToMaturity: { min: 60, max: 90 },
    ...over
  } as CropPlugin;
}

function block(id: string, over: Partial<BlockWithPlantings> = {}): BlockWithPlantings {
  return {
    id,
    name: id,
    acres: 0.01,
    tillageMethod: 'conventional',
    axesLocked: false,
    sunExposure: 'full',
    plantings: [],
    ...over
  } as BlockWithPlantings;
}

function bed(id: string, w = 4, l = 10): BlockWithPlantings {
  return block(id, { acres: (w * l) / 43_560, widthFt: w, lengthFt: l });
}

function seed(id: string, crop: string, qty: number, over: Partial<SeedRequest> = {}): SeedRequest {
  return {
    stockItemId: id,
    cropPluginId: crop,
    varietyDisplayName: id,
    quantityPlants: qty,
    ...over
  };
}

function crop(blockId: string, cropPluginId: string, over: Partial<Crop> = {}): Crop {
  return {
    id: `c-${blockId}-${cropPluginId}`,
    blockId,
    cropPluginId,
    status: 'active',
    plantingDate: NOW - 30 * 86_400_000,
    quantityPlanted: 1,
    ...over
  } as Crop;
}

const index = {
  lettuce: plugin('lettuce'),
  kale: plugin('kale', 'leafy-green'),
  bean: plugin('bean', 'legume'),
  onion: plugin('onion', 'allium'),
  cornA: plugin('cornA', 'corn'),
  cornB: plugin('cornB', 'corn'),
  wide: plugin('wide', 'herb-culinary', {
    defaultRowSpacingInches: 400,
    plantingGuide: { rowSpacingIn: 400, inRowSpacingIn: { min: 12, max: 12 } }
  })
};

function input(
  parts: Partial<PlanInput> & { seeds: SeedRequest[]; blocks: BlockWithPlantings[] }
): PlanInput {
  return {
    axes: parts.blocks.map((b, i) => ({ blockId: b.id, east: i, north: 0 })),
    existingCrops: [],
    pluginIndex: index,
    companions: {},
    nowMs: NOW,
    ...parts
  };
}

function placedOf(assignments: Assignment[], stockItemId: string) {
  return assignments.filter((a) => a.stockItemId === stockItemId).reduce((s, a) => s + a.plants, 0);
}

describe('split engine: one lot over several field blocks', () => {
  it('spreads a lot bigger than one block over the next picked block', () => {
    const blocks = [block('A'), block('B')];
    const fit = plantsFitUsable(blocks[0], index.lettuce);
    const r = planLayout(input({ seeds: [seed('L', 'lettuce', fit + 50)], blocks }));
    expect(new Set(r.assignments.map((a) => a.blockId))).toEqual(new Set(['A', 'B']));
    expect(placedOf(r.assignments, 'L')).toBe(fit + 50);
    expect(r.unplaced).toEqual([]);
    expect(r.leftover).toEqual([]);
  });

  it('reports leftover with every block full when the lot is bigger than all of them', () => {
    const blocks = [block('A'), block('B')];
    const fit = plantsFitUsable(blocks[0], index.lettuce);
    const r = planLayout(input({ seeds: [seed('L', 'lettuce', fit * 3)], blocks }));
    expect(placedOf(r.assignments, 'L')).toBe(fit * 2);
    expect(r.unplaced).toEqual([
      expect.objectContaining({ stockItemId: 'L', quantityPlants: fit })
    ]);
    expect(r.leftover).toEqual([
      {
        stockItemId: 'L',
        cropPluginId: 'lettuce',
        plantsLeft: fit,
        blocks: [
          { blockId: 'A', status: 'full' },
          { blockId: 'B', status: 'full' }
        ]
      }
    ]);
  });

  it('keeps a keep-in-one-bed lot on one block and names the others', () => {
    const blocks = [block('A'), block('B')];
    const fit = plantsFitUsable(blocks[0], index.lettuce);
    const r = planLayout(
      input({ seeds: [seed('L', 'lettuce', fit + 10, { keepInOneBed: true })], blocks })
    );
    expect(new Set(r.assignments.map((a) => a.blockId)).size).toBe(1);
    expect(placedOf(r.assignments, 'L')).toBe(fit);
    const home = r.assignments[0].blockId;
    const other = home === 'A' ? 'B' : 'A';
    expect(r.leftover[0].blocks).toEqual(
      expect.arrayContaining([
        { blockId: home, status: 'full' },
        { blockId: other, status: 'kept-in-one-bed' }
      ])
    );
  });

  it('never puts any part next to a crop it should be kept apart from', () => {
    const blocks = [block('A'), block('B')];
    const fit = plantsFitUsable(blocks[0], index.bean);
    const r = planLayout(
      input({
        seeds: [seed('B', 'bean', fit + 10)],
        blocks,
        existingCrops: [crop('B', 'onion')],
        companions: {
          bean: { goodWith: [], badWith: ['onion'] },
          onion: { goodWith: [], badWith: ['bean'] }
        }
      })
    );
    expect(r.assignments.every((a) => a.blockId === 'A')).toBe(true);
    expect(r.leftover[0].blocks).toEqual(
      expect.arrayContaining([{ blockId: 'B', status: 'keep-apart', withPluginId: 'onion' }])
    );
  });

  it('gives the first part to a block with recent rotation history, but no later part', () => {
    const one = planLayout(
      input({
        seeds: [seed('K', 'kale', 10)],
        blocks: [block('A')],
        existingCrops: [crop('A', 'lettuce', { status: 'harvested' })]
      })
    );
    expect(placedOf(one.assignments, 'K')).toBe(10);

    const blocks = [block('A'), block('B')];
    const fit = plantsFitUsable(blocks[0], index.kale);
    const two = planLayout(
      input({
        seeds: [seed('K', 'kale', fit + 10)],
        blocks,
        existingCrops: [crop('B', 'lettuce', { status: 'harvested' })]
      })
    );
    expect(two.assignments.map((a) => a.blockId)).toEqual(['A']);
    expect(two.leftover[0].blocks).toEqual(
      expect.arrayContaining([{ blockId: 'B', status: 'rotation', withPluginId: 'lettuce' }])
    );
  });

  it('rules out a later part, never the first, on a block holding a crop it crosses with', () => {
    const blocks = [block('A'), block('B')];
    const inp = input({
      seeds: [seed('CA', 'cornA', 10)],
      blocks,
      existingCrops: [crop('B', 'cornB', { plantingDate: NOW - 5 * 365 * 86_400_000 })]
    });
    const onA: Assignment[] = [
      {
        stockItemId: 'CA',
        cropPluginId: 'cornA',
        varietyDisplayName: 'CA',
        blockId: 'A',
        plants: 5,
        score: 0
      }
    ];
    expect(blockRuleOut(inp, inp.seeds[0], 'B', [], true)).toBeNull();
    expect(blockRuleOut(inp, inp.seeds[0], 'B', onA, false)).toEqual({
      blockId: 'B',
      status: 'cross-pollination',
      withPluginId: 'cornB'
    });
    expect(blockRuleOut(inp, seed('CB', 'cornB', 3), 'B', [], false)).toBeNull();
  });

  it('rules out a later part on a block with the wrong sun, never an unknown one', () => {
    const fit = plantsFitUsable(block('A'), index.lettuce);
    const shade = planLayout(
      input({
        seeds: [seed('L', 'lettuce', fit + 5)],
        blocks: [block('A'), block('B', { sunExposure: 'shade' })]
      })
    );
    expect(shade.leftover[0].blocks).toEqual(
      expect.arrayContaining([{ blockId: 'B', status: 'sun' }])
    );
    const unknown = planLayout(
      input({
        seeds: [seed('L', 'lettuce', fit + 5)],
        blocks: [block('A'), block('B', { sunExposure: undefined })]
      })
    );
    expect(unknown.leftover).toEqual([]);
  });

  it('marks narrow and too-small blocks', () => {
    const blocks = [block('A', { acres: 1 }), block('B', { acres: 0.0005 })];
    const st = blockRuleOut(input({ seeds: [], blocks }), seed('W', 'wide', 5), 'B', [], false);
    expect(st?.status).toBe('narrow');
    const tiny = block('T', { acres: 0.00001 });
    const r = planLayout(input({ seeds: [seed('L', 'lettuce', 5)], blocks: [tiny] }));
    expect(r.leftover[0].blocks).toEqual([{ blockId: 'T', status: 'too-small' }]);
  });

  it('places a counted lot on a block that scores below zero when nothing forbids it (R-04)', () => {
    const r = planLayout(
      input({
        seeds: [seed('K', 'kale', 10, { sunRequirement: 'full' })],
        blocks: [block('A', { sunExposure: 'shade' })],
        existingCrops: [crop('A', 'lettuce', { status: 'harvested' })]
      })
    );
    expect(placedOf(r.assignments, 'K')).toBe(10);
  });

  it('is deterministic', () => {
    const blocks = [block('A'), block('B'), block('C')];
    const inp = input({
      seeds: [seed('L', 'lettuce', 900), seed('B', 'bean', 400), seed('K', 'kale', 300)],
      blocks
    });
    expect(planLayout(inp)).toEqual(planLayout(inp));
  });
});

describe('split engine: fields then beds', () => {
  it('sends the beds only the remainder of a lot that partly fitted on fields (R-08)', () => {
    const f = block('F');
    const b = bed('BED', 4, 20);
    const fieldFit = plantsFitUsable(f, index.lettuce);
    const bedFit = bedPlantsFit(b, index.lettuce);
    const qty = fieldFit + Math.floor(bedFit / 2);
    const r = planLayout(
      input({ seeds: [seed('L', 'lettuce', qty)], blocks: [f, b], bedBlockIds: ['BED'] })
    );
    expect(placedOf(r.assignments, 'L')).toBe(qty);
    expect(r.assignments.find((a) => a.blockId === 'BED')!.plants).toBe(qty - fieldFit);
    expect(r.unplaced).toEqual([]);
  });

  it('tops up the free share of the beds after the fair split (R-09)', () => {
    const beds = [bed('b1'), bed('b2')];
    const fit = bedPlantsFit(beds[0], index.lettuce);
    const r = planLayout(
      input({
        seeds: [seed('L', 'lettuce', fit + 6), seed('B', 'bean', 4)],
        blocks: beds,
        bedBlockIds: ['b1', 'b2']
      })
    );
    expect(placedOf(r.assignments, 'B')).toBe(4);
    const lettuce = placedOf(r.assignments, 'L');
    const total = fit * 2 - 4;
    expect(lettuce).toBe(Math.min(fit + 6, total));
    expect(r.leftover).toEqual([]);
  });

  it('reports what does not fit on full beds instead of dropping it', () => {
    const beds = [bed('b1')];
    const fit = bedPlantsFit(beds[0], index.lettuce);
    const r = planLayout(
      input({ seeds: [seed('L', 'lettuce', fit + 7)], blocks: beds, bedBlockIds: ['b1'] })
    );
    expect(r.unplaced).toEqual([expect.objectContaining({ quantityPlants: 7 })]);
    expect(r.leftover).toEqual([
      {
        stockItemId: 'L',
        cropPluginId: 'lettuce',
        plantsLeft: 7,
        blocks: [{ blockId: 'b1', status: 'full' }]
      }
    ]);
  });

  it('keeps a keep-in-one-bed lot on its first bed', () => {
    const beds = [bed('b1'), bed('b2')];
    const fit = bedPlantsFit(beds[0], index.lettuce);
    const r = planLayout(
      input({
        seeds: [seed('L', 'lettuce', fit + 3, { keepInOneBed: true })],
        blocks: beds,
        bedBlockIds: ['b1', 'b2']
      })
    );
    expect(new Set(r.assignments.map((a) => a.blockId)).size).toBe(1);
    expect(placedOf(r.assignments, 'L')).toBe(fit);
    expect(r.leftover[0].plantsLeft).toBe(3);
  });
});

describe('room and the leftover helpers', () => {
  it('holds a field block to one block of space across crops of different sizes', () => {
    const f = block('F');
    const inp = input({ seeds: [], blocks: [f] });
    const wideFit = plantsFitUsable(f, index.bean);
    expect(roomFor(inp, { cropPluginId: 'lettuce' }, 'F', [])).toBe(
      plantsFitUsable(f, index.lettuce)
    );
    const filled: Assignment[] = [
      {
        stockItemId: 'x',
        cropPluginId: 'bean',
        varietyDisplayName: 'x',
        blockId: 'F',
        plants: wideFit,
        score: 0
      }
    ];
    expect(roomFor(inp, { cropPluginId: 'lettuce' }, 'F', filled)).toBe(0);
  });

  it('lists blocks that could still take a short lot', () => {
    const blocks = [block('A'), block('B')];
    const inp = input({ seeds: [seed('L', 'lettuce', 100)], blocks });
    const placed: Assignment[] = [
      {
        stockItemId: 'L',
        cropPluginId: 'lettuce',
        varietyDisplayName: 'L',
        blockId: 'A',
        plants: 10,
        score: 0
      }
    ];
    expect(blocksWithRoomForLeftover(inp, inp.seeds[0], placed)).toEqual(['A', 'B']);
    expect(blocksWithRoomForLeftover(inp, { ...inp.seeds[0], keepInOneBed: true }, placed)).toEqual(
      []
    );
    expect(leftoverReports(inp, placed)).toEqual([
      { stockItemId: 'L', cropPluginId: 'lettuce', plantsLeft: 90, blocks: [] }
    ]);
  });
});
