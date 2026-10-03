/** Phase 35 (R-17): the AI validator holds Claude to the same split rules
 *  as the engine, and the prompt tells it about them. */
import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { BlockWithPlantings } from '$lib/db/blocks';
import type { PlanInput, SeedRequest } from '$lib/layout/engine';
import { plantsFitUsable } from '$lib/layout/sufficiency';
import { bedPlantsFit } from '$lib/layout/bedSharing';
import {
  allocateDeterministic,
  buildAllocationPrompt,
  buildCandidacyMatrix,
  validateAiPlan
} from './aiAllocation';

const lettuce = {
  pluginId: 'lettuce',
  type: 'crop',
  displayName: 'lettuce',
  version: '1.0.0',
  cropFamily: 'leafy-green',
  defaultRowSpacingInches: 12,
  plantingGuide: { rowSpacingIn: 12, inRowSpacingIn: { min: 12, max: 12 } },
  daysToMaturity: { min: 60, max: 90 }
} as CropPlugin;

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

function input(
  seed: Partial<SeedRequest>,
  blocks = [block('A'), block('B')],
  beds: string[] = []
): PlanInput {
  return {
    seeds: [
      {
        stockItemId: 's1',
        cropPluginId: 'lettuce',
        varietyDisplayName: 'Buttercrunch',
        quantityPlants: 100,
        ...seed
      }
    ],
    blocks,
    axes: blocks.map((b, i) => ({ blockId: b.id, east: i, north: 0 })),
    existingCrops: [],
    pluginIndex: { lettuce },
    companions: {},
    bedBlockIds: beds
  };
}

const fitA = plantsFitUsable(block('A'), lettuce);

function plan(inp: PlanInput, rows: Array<[string, number]>, opts = {}) {
  return validateAiPlan(
    {
      rationale: 'r',
      assignments: rows.map(([blockId, plants]) => ({
        stockItemId: 's1',
        blockId,
        plants,
        rationale: 'x'
      }))
    },
    inp,
    buildCandidacyMatrix(inp),
    opts
  );
}

describe('validateAiPlan split rules', () => {
  it('rejects a plan that leaves seed while another picked block has room', () => {
    const inp = input({ quantityPlants: fitA + 40 });
    const r = plan(inp, [['A', fitA]]);
    expect(r.valid).toBe(false);
    if (!r.valid)
      expect(r.violations.some((v) => v.startsWith('unplaced-with-room: s1'))).toBe(true);
  });

  it('accepts the same lot spread over both blocks', () => {
    const inp = input({ quantityPlants: fitA + 40 });
    expect(
      plan(inp, [
        ['A', fitA],
        ['B', 40]
      ]).valid
    ).toBe(true);
  });

  it('accepts seed left over once every block is full', () => {
    const inp = input({ quantityPlants: fitA * 3 });
    expect(
      plan(inp, [
        ['A', fitA],
        ['B', fitA]
      ]).valid
    ).toBe(true);
  });

  it('does not ask a keep-in-one-bed lot to spread, and rejects one on two blocks', () => {
    const inp = input({ quantityPlants: fitA + 40, keepInOneBed: true });
    expect(plan(inp, [['A', fitA]]).valid).toBe(true);
    const two = plan(inp, [
      ['A', fitA],
      ['B', 40]
    ]);
    expect(two.valid).toBe(false);
    if (!two.valid)
      expect(two.violations.some((v) => v.startsWith('kept-in-one-bed: s1'))).toBe(true);
  });

  it('does not check a lot that the farmer asked to cut back on refine', () => {
    const inp = input({ quantityPlants: 80 });
    expect(plan(inp, [['A', 40]], { previousTotals: new Map([['s1', 80]]) }).valid).toBe(true);
    expect(plan(inp, [['A', 40]], { previousTotals: new Map([['s1', 40]]) }).valid).toBe(false);
  });

  it('measures room on shared beds by free share', () => {
    const beds = [
      block('b1', { widthFt: 4, lengthFt: 10, acres: 40 / 43_560 }),
      block('b2', { widthFt: 4, lengthFt: 10, acres: 40 / 43_560 })
    ];
    const fit = bedPlantsFit(beds[0], lettuce);
    const inp = input({ quantityPlants: fit + 5 }, beds, ['b1', 'b2']);
    expect(plan(inp, [['b1', fit]]).valid).toBe(false);
    expect(
      plan(inp, [
        ['b1', fit],
        ['b2', 5]
      ]).valid
    ).toBe(true);
  });
});

describe('allocation prompt and results', () => {
  it('tells Claude to spread lots and names keep-in-one-bed seeds', () => {
    const inp = input({ keepInOneBed: true });
    const prompt = buildAllocationPrompt(buildCandidacyMatrix(inp), inp);
    expect(prompt).toContain('SPREAD BEFORE LEAVING SEED');
    expect(prompt).toContain('keep_in_one_bed=Y');
    expect(prompt).toContain('KEEP IN ONE BED');
    const plain = input({});
    expect(buildAllocationPrompt(buildCandidacyMatrix(plain), plain)).not.toContain(
      'KEEP IN ONE BED'
    );
  });

  it('the engine fallback carries the leftover report', () => {
    const inp = input({ quantityPlants: fitA * 3 });
    const r = allocateDeterministic(inp, 'no-api-key');
    expect(r.leftover).toEqual([
      {
        stockItemId: 's1',
        cropPluginId: 'lettuce',
        plantsLeft: fitA,
        blocks: [
          { blockId: 'A', status: 'full' },
          { blockId: 'B', status: 'full' }
        ]
      }
    ]);
    expect(r.unplaced[0].quantityPlants).toBe(fitA);
  });

  it('the matrix keep-apart flag ignores finished plantings', () => {
    const inp: PlanInput = {
      ...input({}),
      existingCrops: [
        {
          id: 'c1',
          blockId: 'A',
          cropPluginId: 'onion',
          status: 'harvested',
          plantingDate: 0
        } as never,
        {
          id: 'c2',
          blockId: 'B',
          cropPluginId: 'onion',
          status: 'active',
          plantingDate: 0
        } as never
      ],
      companions: { lettuce: { goodWith: [], badWith: ['onion'] } }
    };
    const m = buildCandidacyMatrix(inp);
    expect(m.find((r) => r.blockId === 'A')!.companionBadHere).toEqual([]);
    expect(m.find((r) => r.blockId === 'B')!.companionBadHere).toEqual(['onion']);
  });
});

describe('validateAiPlan holds split parts to the engine rule-outs', () => {
  const solan = (id: string): CropPlugin =>
    ({ ...lettuce, pluginId: id, displayName: id, cropFamily: 'solanaceae' }) as CropPlugin;
  const fit = plantsFitUsable(block('A'), lettuce);

  function twoLots(): PlanInput {
    return {
      seeds: [
        { stockItemId: 'tom', cropPluginId: 'tomato', varietyDisplayName: 'T', quantityPlants: 60 },
        { stockItemId: 'pot', cropPluginId: 'potato', varietyDisplayName: 'P', quantityPlants: 30 }
      ],
      blocks: [block('A'), block('B')],
      axes: [
        { blockId: 'A', east: 0, north: 0 },
        { blockId: 'B', east: 1, north: 0 }
      ],
      existingCrops: [],
      pluginIndex: { tomato: solan('tomato'), potato: solan('potato') },
      companions: {
        tomato: { goodWith: [], badWith: ['potato'] },
        potato: { goodWith: [], badWith: ['tomato'] }
      },
      bedBlockIds: []
    };
  }

  it('rejects keep-apart crops that Claude puts on the same block', () => {
    const inp = twoLots();
    const rows = [
      { stockItemId: 'tom', blockId: 'A', plants: 40, rationale: 'x' },
      { stockItemId: 'pot', blockId: 'A', plants: 30, rationale: 'x' },
      { stockItemId: 'tom', blockId: 'B', plants: 20, rationale: 'x' }
    ];
    const r = validateAiPlan({ rationale: 'r', assignments: rows }, inp, buildCandidacyMatrix(inp));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.violations.some((v) => v.startsWith('keep-apart:'))).toBe(true);
  });

  it('accepts the same lots kept on different blocks', () => {
    const inp = twoLots();
    const rows = [
      { stockItemId: 'tom', blockId: 'A', plants: 60, rationale: 'x' },
      { stockItemId: 'pot', blockId: 'B', plants: 30, rationale: 'x' }
    ];
    expect(
      validateAiPlan({ rationale: 'r', assignments: rows }, inp, buildCandidacyMatrix(inp)).valid
    ).toBe(true);
  });

  it('rejects two parts of a lot on blocks its rotation rules out', () => {
    const now = Date.UTC(2026, 5, 1);
    const inp: PlanInput = {
      ...input({ quantityPlants: fit + 40 }, [block('A'), block('B'), block('C')]),
      nowMs: now,
      pluginIndex: { lettuce, spinach: { ...lettuce, pluginId: 'spinach' } as CropPlugin },
      existingCrops: ['A', 'B'].map(
        (blockId, i) =>
          ({
            id: `c${i}`,
            blockId,
            cropPluginId: 'spinach',
            status: 'harvested',
            plantingDate: now - 100 * 86_400_000
          }) as never
      )
    };
    const bad = plan(inp, [
      ['A', fit],
      ['B', 40]
    ]);
    expect(bad.valid).toBe(false);
    if (!bad.valid)
      expect(bad.violations.some((v) => v.startsWith('split-ruled-out: s1'))).toBe(true);
    expect(
      plan(inp, [
        ['A', fit],
        ['C', 40]
      ]).valid
    ).toBe(true);
  });
});
