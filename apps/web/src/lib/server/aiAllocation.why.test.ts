import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { BlockWithPlantings } from '$lib/db/blocks';
import type { PlanInput, SeedRequest } from '$lib/layout/engine';
import { t } from '$lib/i18n';
import {
  allocateDeterministic,
  buildAllocationPrompt,
  buildCandidacyMatrix,
  splitLotParts,
  threeSistersOnBlock
} from './aiAllocation';

function plugin(pluginId: string, cropFamily: string): CropPlugin {
  return {
    pluginId,
    type: 'crop',
    displayName: pluginId,
    version: '1.0.0',
    cropFamily,
    defaultRowSpacingInches: 12,
    plantingGuide: { rowSpacingIn: 12, inRowSpacingIn: { min: 12, max: 12 } },
    daysToMaturity: { min: 60, max: 90 }
  } as CropPlugin;
}

function block(id: string, sun?: 'full' | 'partial' | 'shade'): BlockWithPlantings {
  return {
    id,
    name: id,
    acres: 0.5,
    tillageMethod: 'conventional',
    axesLocked: false,
    ...(sun ? { sunExposure: sun } : {}),
    plantings: []
  } as BlockWithPlantings;
}

function seed(id: string, cropPluginId: string, quantityPlants = 200): SeedRequest {
  return { stockItemId: id, cropPluginId, varietyDisplayName: id, quantityPlants };
}

const plugins = {
  corn: plugin('corn', 'corn'),
  bean: plugin('bean', 'legume'),
  squash: plugin('squash', 'cucurbit')
};

function input(seeds: SeedRequest[], blocks: BlockWithPlantings[]): PlanInput {
  return {
    seeds,
    blocks,
    axes: blocks.map((b, i) => ({ blockId: b.id, east: i * 10, north: 0 })),
    existingCrops: [],
    pluginIndex: plugins,
    companions: {}
  };
}

const THREE = t(undefined, 'wizard.engine.why.threeSisters');
const PARTIAL = t(undefined, 'wizard.engine.why.sunPartial');
const UNKNOWN = t(undefined, 'wizard.engine.why.sunUnknown');

describe('engine Why text (#690)', () => {
  it('never calls corn and beans three sisters without a squash on the block', () => {
    const result = allocateDeterministic(
      input([seed('c', 'corn'), seed('b', 'bean')], [block('A', 'full'), block('B', 'full')]),
      'no-api-key'
    );
    expect(result.assignments.length).toBeGreaterThan(0);
    for (const why of Object.values(result.perRowRationale)) expect(why).not.toContain(THREE);
  });

  it('calls it three sisters when corn, a bean and a squash share the block', () => {
    const plan = input(
      [seed('c', 'corn', 50), seed('b', 'bean', 50), seed('s', 'squash', 20)],
      [block('A', 'full')]
    );
    const result = allocateDeterministic(plan, 'no-api-key');
    expect(new Set(result.assignments.map((a) => a.cropPluginId)).size).toBe(3);
    expect(threeSistersOnBlock(plan, 'A', result.assignments)).toBe(true);
    for (const why of Object.values(result.perRowRationale)) expect(why).toContain(THREE);
  });

  it('counts a standing crop on the block toward the group', () => {
    const plan: PlanInput = {
      ...input([], [block('A')]),
      existingCrops: [
        {
          id: 'x',
          blockId: 'A',
          cropPluginId: 'squash',
          varietyDisplayName: 'Squash',
          plantingDate: Date.now(),
          status: 'active'
        }
      ] as PlanInput['existingCrops']
    };
    const placed = [
      { blockId: 'A', cropPluginId: 'corn' },
      { blockId: 'A', cropPluginId: 'bean' }
    ];
    expect(threeSistersOnBlock(plan, 'A', placed)).toBe(true);
    expect(threeSistersOnBlock(plan, 'A', placed.slice(0, 1))).toBe(false);
    expect(threeSistersOnBlock(plan, 'B', placed)).toBe(false);
  });

  it('says the sun is not recorded instead of "acceptable" when the block has none', () => {
    const plan = input([seed('c', 'corn')], [block('A')]);
    expect(buildCandidacyMatrix(plan)[0].sunMatch).toBe('unknown');
    const result = allocateDeterministic(plan, 'no-api-key');
    const why = Object.values(result.perRowRationale).join(' ');
    expect(why).toContain(UNKNOWN);
    expect(why).not.toContain(PARTIAL);
  });

  it('still reads partial sun as partial', () => {
    const plan = input([seed('c', 'corn')], [block('A', 'partial')]);
    expect(buildCandidacyMatrix(plan)[0].sunMatch).toBe('partial');
    const why = Object.values(allocateDeterministic(plan, 'no-api-key').perRowRationale).join(' ');
    expect(why).toContain(PARTIAL);
  });

  it('has Spanish for the unknown sun line', () => {
    expect(t('es', 'wizard.engine.why.sunUnknown')).not.toBe(UNKNOWN);
  });

  it('gives a split lot one leftover sentence with lot totals, not one per part (#690)', () => {
    const small = (id: string) => ({ ...block(id, 'full'), acres: 100 / 43_560 });
    const plan = input([seed('b', 'bean', 50_000)], [small('A'), small('B'), small('C')]);
    const result = allocateDeterministic(plan, 'no-api-key');
    const lot = splitLotParts(result.assignments).get('b');
    expect(lot?.parts).toBeGreaterThan(1);
    const whys = result.assignments.map((a) => result.perRowRationale[`b:${a.blockId}`]);
    const lead = t(undefined, 'wizard.engine.why.splitSurplus', {
      parts: lot!.parts,
      fit: lot!.placed.toLocaleString('en-US'),
      avail: (50_000).toLocaleString('en-US'),
      extra: (50_000 - lot!.placed).toLocaleString('en-US')
    });
    expect(whys.filter((w) => w.includes('left over'))).toHaveLength(1);
    expect(whys[0]).toContain(lead);
    expect(whys[0]).toContain('50,000');
    for (const w of whys.slice(1)) expect(w).toContain(t(undefined, 'wizard.engine.why.splitPart'));
  });

  it('counts each lot only once it is on two or more blocks', () => {
    const parts = splitLotParts([
      { stockItemId: 'x', blockId: 'A', plants: 10 },
      { stockItemId: 'y', blockId: 'A', plants: 5 },
      { stockItemId: 'x', blockId: 'B', plants: 7 }
    ]);
    expect([...parts.keys()]).toEqual(['x']);
    expect(parts.get('x')).toEqual({ parts: 2, placed: 17, firstBlockId: 'A' });
  });
});

describe('protected space (#797)', () => {
  const PROTECTED = t(undefined, 'wizard.engine.why.protected');
  const blocks = [block('open', 'full'), block('a-tunnel', 'full')];
  const plan = (seeds: SeedRequest[], bs = blocks): PlanInput => ({
    ...input(seeds, bs),
    protectedBlockIds: ['a-tunnel']
  });

  it('marks protected blocks for Claude and adds a soft preference', () => {
    const p = plan([seed('s', 'squash', 20)]);
    const prompt = buildAllocationPrompt(buildCandidacyMatrix(p), p);
    expect(prompt).toMatch(/- a-tunnel \|.*protected=Y/);
    expect(prompt).not.toMatch(/- open \|.*protected=Y/);
    expect(prompt).toContain('Never leave seed unplaced to keep it out of protected space');
    const plain = input([seed('s', 'squash', 20)], blocks);
    expect(buildAllocationPrompt(buildCandidacyMatrix(plain), plain)).not.toContain('protected');
  });

  it('the engine fallback fills open ground first and explains a tunnel row', () => {
    const open = allocateDeterministic(plan([seed('s', 'squash', 20)]), 'no-api-key');
    expect(open.assignments.map((a) => a.blockId)).toEqual(['open']);
    for (const why of Object.values(open.perRowRationale)) expect(why).not.toContain(PROTECTED);

    const tunnelOnly = allocateDeterministic(
      plan([seed('s', 'squash', 20)], [block('a-tunnel', 'full')]),
      'no-api-key'
    );
    expect(tunnelOnly.assignments.map((a) => a.blockId)).toEqual(['a-tunnel']);
    expect(tunnelOnly.perRowRationale['s:a-tunnel']).toContain(PROTECTED);
    expect(t('es', 'wizard.engine.why.protected')).not.toBe(PROTECTED);
  });
});
