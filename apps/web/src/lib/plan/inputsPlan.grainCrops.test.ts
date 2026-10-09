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

import {
  fertilityBudgetFor,
  herbicideSafeOnCrop,
  planInputs,
  type InputsPlanInput
} from './inputsPlan';

const PLUGINS = path.resolve(__dirname, '../../../../../plugins');
const DAY = 24 * 60 * 60 * 1000;

function crop(id: string): CropPlugin {
  return cropPluginSchema.parse(
    JSON.parse(readFileSync(path.join(PLUGINS, 'crops', `${id}.json`), 'utf8'))
  ) as CropPlugin;
}

const herbicides = [
  'aatrex-4l',
  'glyphosate-4-plus',
  'touchdown-hitech',
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
    expect(post.map((a) => a.productPluginId).sort()).toEqual([
      'aatrex-4l',
      'callisto',
      'glyphosate-4-plus'
    ]);
    for (const a of post) {
      expect(a.windowStartMs).toBe(MAY_1 + 28 * DAY);
      expect(a.windowEndMs).toBe(MAY_1 + 35 * DAY);
    }
    expect(p.warnings.map((w) => w.kind)).not.toContain('no-growth-stage-table');
    expect(p.warnings.map((w) => w.kind)).not.toContain('no-herbicide-timing');
  });

  it('never plans glyphosate or dicamba over a crop no label trait claim covers', () => {
    const p = plan(['corn', 'sorghum-grain-pioneer'], MAY_1);
    const picked = p.applications
      .filter((a) => a.productCategory === 'herbicide')
      .flatMap((a) => [a.productPluginId, ...(a.options ?? []).map((o) => o.pluginId)]);
    for (const id of ['roundup-powermax-3', 'glyphosate-4-plus', 'touchdown-hitech', 'banvel']) {
      expect(picked).not.toContain(id);
    }
  });

  it('offers glyphosate over Roundup Ready corn and soybeans only from labels with a trait claim', () => {
    const corn = plan(['corn-feed-dent-pioneer'], MAY_1).applications.find(
      (a) => a.slot === 'post-emergent' && a.productPluginId === 'glyphosate-4-plus'
    );
    expect(corn?.windowStartMs).toBe(MAY_1 + 28 * DAY);
    expect(corn?.windowEndMs).toBe(MAY_1 + 35 * DAY);
    expect((corn?.options ?? []).map((o) => o.pluginId).sort()).toEqual([
      'glyphosate-4-plus',
      'touchdown-hitech'
    ]);
    const soy = plan(['soybean-asgrow-roundup-ready-2-xtend'], MAY_1).applications.find(
      (a) => a.slot === 'post-emergent' && a.productPluginId === 'glyphosate-4-plus'
    );
    expect(soy?.windowStartMs).toBe(MAY_1 + 21 * DAY);
    expect((soy?.options ?? []).map((o) => o.pluginId)).toEqual(['glyphosate-4-plus']);
  });

  it('a trait claim counts only when the crop carries the trait', () => {
    const c = crop('corn-feed-dent-pioneer');
    const g4 = herbicides.find((h) => h.pluginId === 'glyphosate-4-plus')!;
    expect(herbicideSafeOnCrop(g4, c)).toBe(true);
    expect(herbicideSafeOnCrop(g4, { ...c, traits: [] })).toBe(false);
    expect(herbicideSafeOnCrop(g4, { ...c, pluginId: 'corn' })).toBe(false);
    const rpm = herbicides.find((h) => h.pluginId === 'roundup-powermax-3')!;
    expect(herbicideSafeOnCrop(rpm, c)).toBe(false);
  });

  it('plans a soybean PRE at planting and POSTs three to four weeks later', () => {
    const p = plan(['soybean-asgrow-roundup-ready-2-xtend'], MAY_1);
    const herb = p.applications.filter((a) => a.productCategory === 'herbicide');
    expect(herb.find((a) => a.slot === 'pre-emergent')?.productPluginId).toBe('dual-ii-magnum');
    const post = herb.filter((a) => a.slot === 'post-emergent');
    expect(post.map((a) => a.productPluginId).sort()).toEqual([
      'clethodim-2e',
      'glyphosate-4-plus',
      'reflex'
    ]);
    expect(post.every((a) => a.windowStartMs === MAY_1 + 21 * DAY)).toBe(true);
    const fert = p.applications.find((a) => a.slot === 'pre-plant-fertility');
    expect(fert?.rationale).toMatch(/N 0 lb\/ac, P₂O₅ 40 lb\/ac, K₂O 40 lb\/ac/);
  });

  it('drops post-emergence windows when the weed strategy allows only pre-emergence', () => {
    const p = plan(['corn-feed-dent-pioneer'], MAY_1, { weedStrategy: 'pre-emergence-ok' });
    expect(p.applications.some((a) => a.slot === 'post-emergent')).toBe(false);
    expect(p.applications.filter((a) => a.slot === 'pre-emergent')).toHaveLength(2);
  });

  it('marks a sourced budget data and a family estimate fallback', () => {
    const corn = plan(['corn'], MAY_1).applications;
    expect(corn.find((a) => a.slot === 'pre-plant-fertility')?.budgetProvenance).toBe('fallback');
    expect(corn.find((a) => a.slot === 'pre-plant-fertility')?.rationale).toMatch(
      /typical estimate, not from a source/
    );
    expect(corn.find((a) => a.slot === 'sidedress-n')?.budgetProvenance).toBe('fallback');
    const soy = plan(['soybean-asgrow-roundup-ready-2-xtend'], MAY_1).applications;
    expect(soy.find((a) => a.slot === 'pre-plant-fertility')?.budgetProvenance).toBe('data');
  });

  it('plans winter wheat fertility in the fall and a topdress in late March', () => {
    const p = plan(['wheat-soft-red-winter'], OCT_15);
    expect(p.warnings.map((w) => w.kind)).not.toContain('missing-yield-goal');
    const fert = p.applications.find((a) => a.slot === 'pre-plant-fertility');
    expect(fert?.rationale).toMatch(/N 20 lb\/ac, P₂O₅ 40 lb\/ac, K₂O 40 lb\/ac/);
    const topdress = p.applications.filter((a) => a.slot === 'sidedress-n');
    expect(topdress).toHaveLength(1);
    expect(topdress[0].windowStartMs).toBe(Date.UTC(2026, 2, 21));
    expect(topdress[0].windowEndMs).toBe(Date.UTC(2026, 2, 31));
    expect(topdress[0].rationale).toMatch(/40 lb-N\/ac\) in late March/);
    expect(topdress[0].budgetProvenance).toBe('data');
    const n = (f: string | null) => fertilizers.find((x) => x.pluginId === f)?.analysis.n ?? 0;
    expect(topdress[0].rateAmount).toBe(Math.ceil(40 / (n(topdress[0].productPluginId) / 100)));
  });

  it('plans no wheat herbicide from the unsourced stage table (ruling R720-3)', () => {
    const p = plan(['wheat-soft-red-winter'], OCT_15);
    expect(p.applications.some((a) => a.productCategory === 'herbicide')).toBe(false);
    expect(p.warnings.map((w) => w.kind)).toContain('no-herbicide-timing');
  });

  it('plans barley and rye topdress in February or early March after a fall planting', () => {
    for (const [id, n] of [
      ['barley-grain-thoroughbred', 80],
      ['rye-grain-aroostook', 60]
    ] as const) {
      const td = plan([id], OCT_15).applications.filter((a) => a.slot === 'sidedress-n');
      expect(td, id).toHaveLength(1);
      expect(td[0].windowStartMs).toBe(Date.UTC(2026, 1, 1));
      expect(td[0].windowEndMs).toBe(Date.UTC(2026, 2, 10));
      expect(td[0].rationale).toMatch(new RegExp(`${n} lb-N/ac\\) in February or early March`));
    }
  });

  it('a stage topdress on a crop without that stage warns and plans nothing', () => {
    const wheat = crop('wheat-soft-red-winter');
    const noTable = {
      ...wheat,
      pluginId: 'wheat-no-table',
      growthStageTable: undefined,
      sprayWindows: [],
      fertility: { ...wheat.fertility!, topdressN: [{ stageCode: 'Z30', nLbPerAcre: 40 }] }
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
      'clover-red-mammoth',
      'pearl-millet-tifleaf',
      'foxtail-millet-japanese',
      'sudangrass-piper',
      'bmr-sorghum-sudan'
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
