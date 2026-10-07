import { describe, expect, it } from 'vitest';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { BlockWithPlantings } from '$lib/db/blocks';
import type { PlanInput, SeedRequest } from '$lib/layout/engine';
import { t } from '$lib/i18n';
import { allocateDeterministic, buildCandidacyMatrix, threeSistersOnBlock } from './aiAllocation';

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
});
