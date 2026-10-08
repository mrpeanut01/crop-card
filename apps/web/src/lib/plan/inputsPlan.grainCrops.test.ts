import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Block, PlantingRecord } from '$lib/db/blocks';
import {
  cropPluginSchema,
  fertilizerPluginSchema,
  herbicidePluginSchema,
  type CropPlugin,
  type FertilizerPlugin,
  type HerbicidePlugin
} from '$lib/plugins/schemas';
import type { SeasonSetup } from '$lib/season/setup';

import { fertilityBudgetFor, planInputs, type InputsPlanInput } from './inputsPlan';

const PLUGINS = path.resolve(__dirname, '../../../../../plugins');
const DAY = 24 * 60 * 60 * 1000;

function crop(id: string): CropPlugin {
  return cropPluginSchema.parse(
    JSON.parse(readFileSync(path.join(PLUGINS, 'crops', `${id}.json`), 'utf8'))
  ) as CropPlugin;
}

const herbicides = [
  'aatrex-4l',
  'dual-ii-magnum',
  'roundup-powermax-3',
  'banvel',
  'harmony-sg-thifensulfuron',
  'reflex',
  'clethodim-2e',
  'callisto'
].map(
  (id) =>
    herbicidePluginSchema.parse(
      JSON.parse(readFileSync(path.join(PLUGINS, 'herbicides', `${id}.json`), 'utf8'))
    ) as HerbicidePlugin
);

const fertilizers = readdirSync(path.join(PLUGINS, 'fertilizers'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(path.join(PLUGINS, 'fertilizers', f), 'utf8')))
  .map((j) => fertilizerPluginSchema.safeParse(j))
  .filter((r) => r.success)
  .map((r) => r.data as FertilizerPlugin);

const setup: SeasonSetup = {
  philosophy: 'conventional',
  weedStrategy: 'post-emergence-ok',
  pestStrategy: 'preventive',
  fertilityApproach: 'synthetic',
  coverCropIntent: 'none',
  transitioningStartedYear: null,
  year: 2026,
  setAt: 0
};

const block = (id: string): Block => ({
  id,
  name: id,
  acres: 10,
  blockLabel: id,
  tillageMethod: 'conventional',
  axesLocked: false
});

function plan(cropIds: string[], plantingMs: number, overrides: Partial<SeasonSetup> = {}) {
  const crops = Object.fromEntries(cropIds.map((id) => [id, crop(id)]));
  const plantings: PlantingRecord[] = cropIds.map((id, i) => ({
    id: `p${i}`,
    blockId: `b${i}`,
    cropPluginId: id,
    varietyDisplayName: id,
    plantingDate: plantingMs
  }));
  const input: InputsPlanInput = {
    plantings,
    blocks: cropIds.map((_, i) => block(`b${i}`)),
    cropPlugins: crops,
    seasonSetup: { ...setup, ...overrides },
    soilTests: [],
    fertilityCredits: [],
    productPlugins: { herbicides, insecticides: [], fertilizers, fungicides: [] },
    existingStock: [],
    year: 2026,
    nowMs: 0
  };
  return planInputs(input);
}

const MAY_1 = Date.UTC(2026, 4, 1);
const OCT_15 = Date.UTC(2025, 9, 15);

describe('#720 field corn, soybean, sorghum and wheat in the inputs plan', () => {
  it('plans pre- and post-emergence herbicides for field corn from days after planting', () => {
    const p = plan(['corn-feed-dent-pioneer'], MAY_1);
    const pre = p.applications.filter((a) => a.slot === 'pre-emergent');
    const post = p.applications.filter((a) => a.slot === 'post-emergent');
    expect(pre.map((a) => a.productPluginId).sort()).toEqual(['aatrex-4l', 'dual-ii-magnum']);
    expect(pre.every((a) => a.windowStartMs === MAY_1)).toBe(true);
    expect(post.map((a) => a.productPluginId).sort()).toEqual(['aatrex-4l', 'callisto']);
    for (const a of post) {
      expect(a.windowStartMs).toBe(MAY_1 + 28 * DAY);
      expect(a.windowEndMs).toBe(MAY_1 + 35 * DAY);
    }
    expect(p.warnings.map((w) => w.kind)).not.toContain('no-growth-stage-table');
    expect(p.warnings.map((w) => w.kind)).not.toContain('no-herbicide-timing');
  });

  it('never plans glyphosate or dicamba over the crop', () => {
    const p = plan(
      ['corn', 'soybean-asgrow-roundup-ready-2-xtend', 'sorghum-grain-pioneer'],
      MAY_1
    );
    const picked = p.applications
      .filter((a) => a.productCategory === 'herbicide')
      .map((a) => a.productPluginId);
    expect(picked).not.toContain('roundup-powermax-3');
    expect(picked).not.toContain('banvel');
  });

  it('plans a soybean PRE at planting and POSTs three to four weeks later', () => {
    const p = plan(['soybean-asgrow-roundup-ready-2-xtend'], MAY_1);
    const herb = p.applications.filter((a) => a.productCategory === 'herbicide');
    expect(herb.find((a) => a.slot === 'pre-emergent')?.productPluginId).toBe('dual-ii-magnum');
    const post = herb.filter((a) => a.slot === 'post-emergent');
    expect(post.map((a) => a.productPluginId).sort()).toEqual(['clethodim-2e', 'reflex']);
    expect(post.every((a) => a.windowStartMs === MAY_1 + 21 * DAY)).toBe(true);
    const fert = p.applications.find((a) => a.slot === 'pre-plant-fertility');
    expect(fert?.rationale).toMatch(/N 0 lb\/ac, P₂O₅ 40 lb\/ac, K₂O 40 lb\/ac/);
  });

  it('drops post-emergence windows when the weed strategy allows only pre-emergence', () => {
    const p = plan(['corn-feed-dent-pioneer'], MAY_1, { weedStrategy: 'pre-emergence-ok' });
    expect(p.applications.some((a) => a.slot === 'post-emergent')).toBe(false);
    expect(p.applications.filter((a) => a.slot === 'pre-emergent')).toHaveLength(2);
  });

  it('plans winter wheat fertility in the fall and a topdress at jointing', () => {
    const wheat = crop('wheat-soft-red-winter');
    const p = plan(['wheat-soft-red-winter'], OCT_15);
    expect(p.warnings.map((w) => w.kind)).not.toContain('missing-yield-goal');
    const fert = p.applications.find((a) => a.slot === 'pre-plant-fertility');
    expect(fert?.rationale).toMatch(/N 20 lb\/ac, P₂O₅ 40 lb\/ac, K₂O 40 lb\/ac/);
    const topdress = p.applications.filter((a) => a.slot === 'sidedress-n');
    expect(topdress).toHaveLength(1);
    const z30 = wheat.growthStageTable!.stages.find((s) => s.code === 'Z30')!;
    expect(topdress[0].windowStartMs).toBe(OCT_15 + z30.daysFromPlanting.min * DAY);
    expect(topdress[0].windowEndMs).toBe(OCT_15 + z30.daysFromPlanting.max * DAY);
    expect(topdress[0].rationale).toMatch(/40 lb-N\/ac.*Z30/);
    const n = (f: string | null) => fertilizers.find((x) => x.pluginId === f)?.analysis.n ?? 0;
    expect(topdress[0].rateAmount).toBe(Math.ceil(40 / (n(topdress[0].productPluginId) / 100)));
  });

  it('plans a wheat herbicide inside the plugin stage table', () => {
    const p = plan(['wheat-soft-red-winter'], OCT_15);
    const herb = p.applications.filter((a) => a.productCategory === 'herbicide');
    expect(herb.map((a) => a.productPluginId)).toEqual(['harmony-sg-thifensulfuron']);
    expect(p.warnings.map((w) => w.kind)).not.toContain('no-herbicide-timing');
  });

  it('a stage topdress on a crop without that stage warns and plans nothing', () => {
    const wheat = crop('wheat-soft-red-winter');
    const noTable = {
      ...wheat,
      pluginId: 'wheat-no-table',
      growthStageTable: undefined,
      sprayWindows: []
    };
    const input: InputsPlanInput = {
      plantings: [
        {
          id: 'p0',
          blockId: 'b0',
          cropPluginId: 'wheat-no-table',
          varietyDisplayName: 'w',
          plantingDate: OCT_15
        }
      ],
      blocks: [block('b0')],
      cropPlugins: { 'wheat-no-table': noTable as CropPlugin },
      seasonSetup: setup,
      soilTests: [],
      fertilityCredits: [],
      productPlugins: { herbicides, insecticides: [], fertilizers, fungicides: [] },
      existingStock: [],
      year: 2026,
      nowMs: 0
    };
    const p = planInputs(input);
    expect(p.applications.some((a) => a.slot === 'sidedress-n')).toBe(false);
    expect(p.warnings).toContainEqual(
      expect.objectContaining({ kind: 'no-growth-stage-table', slot: 'sidedress-n' })
    );
  });

  it('small grains, sorghum and forage seedings no longer lack a fertility budget', () => {
    for (const id of [
      'wheat-hard-white-winter',
      'barley-grain-thoroughbred',
      'rye-grain-aroostook',
      'sorghum-grain-pioneer',
      'alfalfa-vernema',
      'clover-red-mammoth'
    ]) {
      const c = crop(id);
      expect(fertilityBudgetFor(c)?.sourced, id).toBe(true);
      const p = plan([id], MAY_1);
      expect(
        p.warnings.map((w) => w.kind),
        id
      ).not.toContain('missing-yield-goal');
      expect(
        p.applications.some((a) => a.slot === 'pre-plant-fertility'),
        id
      ).toBe(true);
    }
  });

  it('a crop with its own budget gets no family sidedress', () => {
    const p = plan(['sorghum-grain-pioneer'], MAY_1);
    expect(p.applications.some((a) => a.slot === 'sidedress-n')).toBe(false);
  });
});
