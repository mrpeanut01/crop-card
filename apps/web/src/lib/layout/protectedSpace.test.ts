import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { BlockWithPlantings } from '$lib/db/blocks';
import {
  isProtectedBlock,
  planLayout,
  type Assignment,
  type PlanInput,
  type SeedRequest
} from './engine';
import { protectedBlockIds } from './bedSharing';
import { blocksWithRoomForLeftover } from './split';

function crop(id: string, family: string, rowIn: number, inRow: [number, number]): CropPlugin {
  return {
    pluginId: id,
    type: 'crop',
    displayName: id,
    version: '1.0.0',
    cropFamily: family,
    defaultRowSpacingInches: rowIn,
    plantingGuide: { rowSpacingIn: rowIn, inRowSpacingIn: { min: inRow[0], max: inRow[1] } },
    daysToMaturity: { min: 95, max: 100 }
  } as CropPlugin;
}

const delicata = crop('winter-squash-delicata', 'cucurbit', 36, [24, 48]);
const tomato = crop('tomato', 'solanaceae', 36, [24, 24]);
const lettuce = crop('lettuce', 'leafy-green', 12, [8, 8]);
const PLUGINS: Record<string, CropPlugin> = { delicata, tomato, lettuce };
const pluginIndex = {
  [delicata.pluginId]: delicata,
  [tomato.pluginId]: tomato,
  [lettuce.pluginId]: lettuce
};

function bed(id: string, fieldId: string, widthFt: number, lengthFt: number): BlockWithPlantings {
  return {
    id,
    name: id,
    acres: (widthFt * lengthFt) / 43_560,
    widthFt,
    lengthFt,
    tillageMethod: 'no-till',
    axesLocked: false,
    sunExposure: 'full',
    fieldId,
    plantings: []
  };
}

function fieldBlock(id: string, fieldId: string, acres: number): BlockWithPlantings {
  return {
    id,
    name: id,
    acres,
    tillageMethod: 'conventional',
    axesLocked: false,
    sunExposure: 'full',
    fieldId,
    plantings: []
  };
}

function seed(id: string, pluginId: string, plants: number, fill = false): SeedRequest {
  return {
    stockItemId: id,
    cropPluginId: pluginId,
    varietyDisplayName: id,
    quantityPlants: plants,
    ...(fill ? { fillToCapacity: true } : {})
  };
}

const AREAS = [
  { id: 'garden', kind: 'garden' },
  { id: 'tunnel', kind: 'greenhouse' },
  { id: 'north', kind: 'field' }
];

/** The Willow Run demo layout: eight 4 × 16 ft garden beds and two
 *  4 × 64 ft high tunnel beds. */
function willowRun(): BlockWithPlantings[] {
  const garden = Array.from({ length: 8 }, (_, i) => bed(`g${i + 1}`, 'garden', 4, 16));
  return [...garden, bed('tE', 'tunnel', 4, 64), bed('tW', 'tunnel', 4, 64)];
}

function planInput(
  seeds: SeedRequest[],
  blocks: BlockWithPlantings[],
  opts: { beds?: boolean; protectedSpace?: boolean } = {}
): PlanInput {
  const { beds = true, protectedSpace = true } = opts;
  return {
    seeds,
    blocks,
    axes: blocks.map((b, i) => ({ blockId: b.id, east: i, north: 0 })),
    existingCrops: [],
    pluginIndex,
    companions: {},
    ...(beds ? { bedBlockIds: blocks.filter((b) => b.fieldId !== 'north').map((b) => b.id) } : {}),
    ...(protectedSpace ? { protectedBlockIds: protectedBlockIds(blocks, AREAS) } : {})
  };
}

const plantsOn = (as: ReadonlyArray<Assignment>, ids: ReadonlyArray<string>) =>
  as.filter((a) => ids.includes(a.blockId)).reduce((s, a) => s + a.plants, 0);
const TUNNEL = ['tE', 'tW'];

describe('#797 protected space preference', () => {
  it('only blocks in greenhouse Areas are protected', () => {
    expect(protectedBlockIds(willowRun(), AREAS)).toEqual(['tE', 'tW']);
    expect(isProtectedBlock({ protectedBlockIds: ['tE'] }, 'tE')).toBe(true);
    expect(isProtectedBlock({}, 'tE')).toBe(false);
  });

  it('root cause: without the preference Delicata lands in the tunnel', () => {
    const r = planLayout(
      planInput([seed('d', delicata.pluginId, 12)], willowRun(), { protectedSpace: false })
    );
    expect(plantsOn(r.assignments, TUNNEL)).toBeGreaterThan(0);
  });

  it('puts Delicata on the open garden beds when they have room', () => {
    const r = planLayout(planInput([seed('d', delicata.pluginId, 12)], willowRun()));
    expect(plantsOn(r.assignments, TUNNEL)).toBe(0);
    expect(r.assignments.reduce((s, a) => s + a.plants, 0)).toBe(12);
    expect(r.unplaced).toEqual([]);
  });

  it('a fill-to-bed seed takes an open bed first', () => {
    const blocks = willowRun();
    const r = planLayout(planInput([seed('d', delicata.pluginId, 400, true)], blocks));
    expect(plantsOn(r.assignments, TUNNEL)).toBe(0);
    expect(r.assignments.length).toBeGreaterThan(0);
  });

  it('still uses the tunnel once the open beds are full', () => {
    const blocks = willowRun();
    const without = planLayout(
      planInput([seed('d', delicata.pluginId, 200)], blocks, { protectedSpace: false })
    );
    const withPref = planLayout(planInput([seed('d', delicata.pluginId, 200)], blocks));
    expect(plantsOn(withPref.assignments, TUNNEL)).toBeGreaterThan(0);
    const total = (as: ReadonlyArray<Assignment>) => as.reduce((s, a) => s + a.plants, 0);
    expect(total(withPref.assignments)).toBe(total(without.assignments));
  });

  it('uses the tunnel when it is the only block picked', () => {
    const tunnelOnly = willowRun().filter((b) => b.fieldId === 'tunnel');
    const r = planLayout(planInput([seed('d', delicata.pluginId, 12)], tunnelOnly));
    expect(plantsOn(r.assignments, TUNNEL)).toBe(12);
    const fill = planLayout(planInput([seed('f', delicata.pluginId, 400, true)], tunnelOnly));
    expect(plantsOn(fill.assignments, TUNNEL)).toBeGreaterThan(0);
  });

  it('splits over two small open beds before using one tunnel bed that holds it all', () => {
    const blocks = [
      bed('b0', 'garden', 3, 8),
      bed('b1', 'garden', 3, 8),
      bed('b2', 'tunnel', 3, 12)
    ];
    const r = planLayout(planInput([seed('s', delicata.pluginId, 4)], blocks));
    expect(plantsOn(r.assignments, ['b0', 'b1'])).toBe(4);
    expect(plantsOn(r.assignments, ['b2'])).toBe(0);
  });

  it('ranks an open field block ahead of a protected one on the field model too', () => {
    const blocks = [fieldBlock('a-tunnel', 'tunnel', 0.25), fieldBlock('b-open', 'north', 0.25)];
    const r = planLayout(planInput([seed('d', delicata.pluginId, 20)], blocks, { beds: false }));
    expect(r.assignments.map((a) => a.blockId)).toEqual(['b-open']);
    const off = planLayout(
      planInput([seed('d', delicata.pluginId, 20)], blocks, { beds: false, protectedSpace: false })
    );
    expect(off.assignments.map((a) => a.blockId)).toEqual(['a-tunnel']);
  });

  const ID = fc.constantFrom(...Object.keys(PLUGINS));
  const seedsArb = fc
    .array(fc.tuple(ID, fc.integer({ min: 1, max: 120 }), fc.boolean()), {
      minLength: 1,
      maxLength: 4
    })
    .map((rows) =>
      rows.map(([p, n, fill], i) => seed(`s${i}`, PLUGINS[p].pluginId, n, fill && i % 2 === 0))
    );
  const bedsArb = fc
    .array(
      fc.tuple(fc.boolean(), fc.integer({ min: 3, max: 6 }), fc.integer({ min: 8, max: 64 })),
      { minLength: 1, maxLength: 5 }
    )
    .map((rows) => rows.map(([prot, w, l], i) => bed(`b${i}`, prot ? 'tunnel' : 'garden', w, l)));

  it('never refuses a placement that fits: leftover only when no block has room', () => {
    fc.assert(
      fc.property(seedsArb, bedsArb, (seeds, blocks) => {
        const input = planInput(seeds, blocks);
        const r = planLayout(input);
        for (const s of seeds) {
          expect(blocksWithRoomForLeftover(input, s, r.assignments)).toEqual([]);
        }
      }),
      { numRuns: 150 }
    );
  });

  it('an all-protected selection plans exactly as it did before', () => {
    fc.assert(
      fc.property(seedsArb, bedsArb, (seeds, rows) => {
        const blocks = rows.map((b) => ({ ...b, fieldId: 'tunnel' }));
        const on = planLayout(planInput(seeds, blocks));
        const off = planLayout(planInput(seeds, blocks, { protectedSpace: false }));
        expect(on.assignments).toEqual(off.assignments);
        expect(on.unplaced).toEqual(off.unplaced);
      }),
      { numRuns: 150 }
    );
  });

  it('a lone counted seed that fits on open beds never takes protected space', () => {
    fc.assert(
      fc.property(ID, fc.integer({ min: 1, max: 200 }), bedsArb, (p, n, blocks) => {
        const s = seed('s', PLUGINS[p].pluginId, n);
        const input = planInput([s], blocks);
        const open = blocks.filter((b) => b.fieldId !== 'tunnel').map((b) => b.id);
        const openOnly = planLayout(
          planInput(
            [s],
            blocks.filter((b) => open.includes(b.id))
          )
        );
        fc.pre(openOnly.unplaced.length === 0 && open.length > 0);
        const r = planLayout(input);
        expect(plantsOn(r.assignments, open)).toBe(n);
      }),
      { numRuns: 150 }
    );
  });
});
