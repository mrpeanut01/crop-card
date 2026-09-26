import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bedRecipePluginSchema } from '$lib/plugins/schemas';
import type { GardenCrop, OccupancyInterval } from './types';

import {
  applyRecipe,
  deterministicFill,
  deterministicFillPlan,
  frostFreeDays,
  recipeFits,
  sectionFootprint,
  type BedRecipePlugin,
  type RecipeContext
} from './recipes';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS = path.resolve(here, '../../../../../plugins');
const DAY = 86_400_000;
const utc = (m: number, d: number, y = 2027) => Date.UTC(y, m - 1, d);

function recipe(id: string): BedRecipePlugin {
  return bedRecipePluginSchema.parse(
    JSON.parse(readFileSync(path.join(PLUGINS, 'bed-recipes', `${id}.json`), 'utf-8'))
  );
}

function crop(id: string): GardenCrop {
  return JSON.parse(readFileSync(path.join(PLUGINS, 'crops', `${id}.json`), 'utf-8'));
}

const CROPS: Record<string, GardenCrop> = Object.fromEntries(
  [
    'lettuce-black-seeded-simpson',
    'lettuce-buttercrunch',
    'lettuce-red-sails',
    'spinach-space-f1',
    'bush-bean-provider',
    'kale-red-russian',
    'garlic-music-hardneck',
    'zucchini-black-beauty',
    'radish-cherry-belle',
    'tomato-celebrity-f1',
    'carrot-nantes-half-long',
    'corn-bantam-sweet',
    'pole-bean-kentucky-wonder',
    'winter-squash-delicata',
    'tomato-roma-vf',
    'basil-genovese'
  ].map((id) => [id, crop(id)])
);

function ctx(overrides: Partial<RecipeContext> = {}): RecipeContext {
  return {
    bed: { blockId: 'bed-1', widthFt: 4, lengthFt: 8 },
    crops: CROPS,
    lastSpringFrostMs: utc(4, 15),
    firstFallFrostMs: utc(10, 24),
    intervals: [],
    seasonYear: 2027,
    ...overrides
  };
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe('recipeFits', () => {
  const r = recipe('spring-greens-beans-fall-brassicas');

  it('fits inside the frost-free range', () => {
    expect(recipeFits(r, frostFreeDays(utc(4, 15), utc(10, 24)))).toEqual({ fits: true });
  });

  it('says why a short season does not fit', () => {
    expect(recipeFits(r, 120)).toEqual({
      fits: false,
      reason: 'Needs about 145 frost-free days. Your season has 120.'
    });
  });

  it('honors a maximum and treats no range as always fitting', () => {
    const capped = { ...r, frostFreeDays: { min: 100, max: 150 } };
    expect(recipeFits(capped, 192)).toMatchObject({ fits: false });
    expect(recipeFits({ ...r, frostFreeDays: undefined }, 10)).toEqual({ fits: true });
  });
});

describe('sectionFootprint', () => {
  it('scales fractions to 6 in steps inside the bed', () => {
    expect(sectionFootprint({ x: 0.25, y: 0, w: 0.5, l: 1 }, { widthFt: 4, lengthFt: 8 })).toEqual({
      x_in: 12,
      y_in: 0,
      w_in: 24,
      l_in: 96
    });
    const fp = sectionFootprint({ x: 0.9, y: 0.95, w: 0.1, l: 0.05 }, { widthFt: 3, lengthFt: 10 });
    expect(fp.w_in).toBeGreaterThanOrEqual(6);
    expect(fp.x_in + fp.w_in).toBeLessThanOrEqual(36);
    expect(fp.y_in + fp.l_in).toBeLessThanOrEqual(120);
  });
});

describe('applyRecipe', () => {
  it('lays out the salad succession as four slices, two weeks apart', () => {
    const app = applyRecipe(
      recipe('salad-succession'),
      ctx({ bed: { blockId: 'b', widthFt: 3, lengthFt: 10 } })
    );
    expect(app.skipped).toEqual([]);
    expect(app.warnings).toEqual([]);
    expect(app.plantings.map((p) => iso(p.plantingDateMs))).toEqual([
      '2027-03-18',
      '2027-04-01',
      '2027-04-15',
      '2027-04-29'
    ]);
    expect(app.plantings.map((p) => p.footprint)).toEqual([
      { x_in: 0, y_in: 0, w_in: 36, l_in: 30 },
      { x_in: 0, y_in: 30, w_in: 36, l_in: 30 },
      { x_in: 0, y_in: 60, w_in: 36, l_in: 30 },
      { x_in: 0, y_in: 90, w_in: 36, l_in: 30 }
    ]);
    expect(app.plantings.map((p) => p.followsKey)).toEqual([null, 's0', 's0.1', 's0.2']);
    expect(new Set(app.plantings.map((p) => p.provenance))).toEqual(new Set(['plugin']));
    expect(app.plantings[0]).toMatchObject({
      cropPluginId: 'lettuce-black-seeded-simpson',
      plantCount: 9,
      note: 'Each sowing takes the next quarter of the bed.'
    });
  });

  it('starts an after-step crop when the earlier step frees the bed', () => {
    const app = applyRecipe(recipe('spring-greens-beans-fall-brassicas'), ctx());
    expect(app.skipped).toEqual([]);
    const [lettuce, spinach, beans, kale] = app.plantings;
    expect(iso(lettuce.plantingDateMs)).toBe('2027-03-18');
    expect(iso(spinach.plantingDateMs)).toBe('2027-03-18');
    expect(spinach.cropPluginId).toBe('spinach-space-f1');
    expect(beans.plantingDateMs).toBe(lettuce.plantingDateMs + (45 + 21 + 10) * DAY);
    expect(beans.followsKey).toBe('s0');
    expect(iso(kale.plantingDateMs)).toBe('2027-08-01');
    expect(beans.footprint).toEqual(lettuce.footprint);
  });

  it('dates a fall-planted garlic step in the previous year', () => {
    const app = applyRecipe(recipe('garlic-then-summer-squash'), ctx());
    expect(app.skipped).toEqual([]);
    expect(iso(app.plantings[0].plantingDateMs)).toBe('2026-10-17');
    expect(app.plantings[1].plantingDateMs).toBe(
      app.plantings[0].plantingDateMs + (270 + 10) * DAY
    );
  });

  it('warns about interplanting and scaling but never blocks on it', () => {
    const app = applyRecipe(
      recipe('three-sisters-4x8'),
      ctx({ bed: { blockId: 'b', widthFt: 4, lengthFt: 10 } })
    );
    expect(app.skipped).toEqual([]);
    expect(app.plantings).toHaveLength(4);
    expect(app.warnings[0]).toBe('Written for a 4×8 ft bed and scaled to this 4×10 ft bed.');
    expect(
      app.warnings.some((w) =>
        w.startsWith(`${CROPS['pole-bean-kentucky-wonder'].displayName} shares space with`)
      )
    ).toBe(true);
    expect(app.plantings[0]).toMatchObject({ spacing: { pattern: 'sfg' }, plantCount: 20 });
  });

  it('uses an alternate when the primary crop is missing', () => {
    const crops = { ...CROPS };
    delete crops['lettuce-black-seeded-simpson'];
    const app = applyRecipe(
      recipe('salad-succession'),
      ctx({ crops, bed: { blockId: 'b', widthFt: 3, lengthFt: 10 } })
    );
    expect(app.plantings[0].cropPluginId).toBe('lettuce-red-sails');
    expect(app.warnings).toEqual([
      `Used ${CROPS['lettuce-red-sails'].displayName} in place of lettuce-black-seeded-simpson.`
    ]);
  });

  it('skips an unknown crop and every step that follows it', () => {
    const crops = { ...CROPS };
    delete crops['radish-cherry-belle'];
    const app = applyRecipe(recipe('radishes-then-tomatoes'), ctx({ crops }));
    expect(app.plantings).toEqual([]);
    expect(app.skipped.map((s) => s.stepIndex)).toEqual([0, 1]);
    expect(app.skipped[1].reason).toBe('Follows step 1, which could not be placed.');
  });

  it('skips a step whose spot is taken on that date', () => {
    const existing: OccupancyInterval = {
      cropId: 'c1',
      blockId: 'bed-1',
      startMs: utc(3, 1),
      harvestStartMs: utc(5, 1),
      harvestEndMs: utc(5, 21),
      endMs: utc(6, 1),
      footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 24 },
      actual: false
    };
    const app = applyRecipe(
      recipe('spring-greens-beans-fall-brassicas'),
      ctx({ intervals: [existing] })
    );
    expect(app.skipped[0]).toEqual({
      stepIndex: 0,
      reason: `No room for ${CROPS['lettuce-black-seeded-simpson'].displayName} on Mar 18. That part of the bed opens Jun 1.`
    });
    expect(app.plantings.map((p) => p.key)).toEqual(['s1', 's3']);
  });

  it('ignores intervals from other beds', () => {
    const other: OccupancyInterval = {
      cropId: 'c1',
      blockId: 'bed-2',
      startMs: utc(1, 1),
      harvestStartMs: utc(11, 1),
      harvestEndMs: utc(11, 1),
      endMs: utc(12, 1),
      footprint: null,
      actual: false
    };
    expect(
      applyRecipe(recipe('tomato-and-basil'), ctx({ intervals: [other] })).plantings
    ).toHaveLength(2);
  });

  it('skips a crop that cannot mature before the first fall frost', () => {
    const app = applyRecipe(
      recipe('three-sisters-4x8'),
      ctx({ lastSpringFrostMs: utc(6, 1), firstFallFrostMs: utc(8, 20) })
    );
    const reasons = app.skipped.map((s) => s.reason);
    expect(
      reasons.some((r) => r.includes('would not be ready before the first fall frost on Aug 20'))
    ).toBe(true);
  });
});

describe('deterministicFill', () => {
  const recipes = [
    recipe('salad-succession'),
    recipe('spring-greens-beans-fall-brassicas'),
    recipe('tomato-and-basil'),
    recipe('carrots-then-fall-spinach')
  ];

  it('uses the best-fitting recipe and tags it fallback', () => {
    const plan = deterministicFillPlan(recipes, [], ctx(), utc(3, 1));
    expect(plan.recipe?.pluginId).toBe('spring-greens-beans-fall-brassicas');
    expect(plan.proposals).toHaveLength(4);
    expect(new Set(plan.proposals.map((p) => p.provenance))).toEqual(new Set(['fallback']));
  });

  it('drops plantings before the chosen date and unlinks them', () => {
    const plan = deterministicFillPlan(recipes, [], ctx(), utc(7, 15));
    expect(plan.proposals.length).toBeGreaterThan(0);
    for (const p of plan.proposals) {
      expect(p.plantingDateMs).toBeGreaterThanOrEqual(utc(7, 15));
      if (p.followsKey) expect(plan.proposals.some((q) => q.key === p.followsKey)).toBe(true);
    }
  });

  it('packs planned crops by spacing when no recipe fits the season', () => {
    const short = ctx({ lastSpringFrostMs: utc(5, 20), firstFallFrostMs: utc(8, 10) });
    const plan = deterministicFillPlan(
      recipes,
      [
        { cropPluginId: 'lettuce-buttercrunch', varietyDisplayName: 'Buttercrunch', plants: 8 },
        { cropPluginId: 'not-a-crop', varietyDisplayName: 'Mystery', plants: 4 }
      ],
      short,
      utc(5, 25)
    );
    expect(plan.recipe).toBeNull();
    expect(plan.proposals).toHaveLength(1);
    expect(plan.proposals[0]).toMatchObject({
      cropPluginId: 'lettuce-buttercrunch',
      varietyDisplayName: 'Buttercrunch',
      provenance: 'fallback',
      plantingDateMs: utc(5, 25),
      footprint: { x_in: 0, y_in: 0, w_in: 48, l_in: 18 },
      plantCount: 12
    });
  });

  it('returns nothing when the bed is full', () => {
    const full: OccupancyInterval = {
      cropId: 'c1',
      blockId: 'bed-1',
      startMs: utc(1, 1),
      harvestStartMs: utc(6, 1),
      harvestEndMs: utc(12, 1),
      endMs: utc(12, 31),
      footprint: null,
      actual: false
    };
    expect(
      deterministicFill(
        recipes,
        [{ cropPluginId: 'lettuce-buttercrunch', varietyDisplayName: 'B', plants: null }],
        ctx({ intervals: [full] }),
        utc(4, 1)
      )
    ).toEqual([]);
  });
});
