import { describe, expect, it } from 'vitest';
import {
  harvestTimingByPlanting,
  harvestTimingHints,
  harvestTimingLabel,
  harvestTimingText,
  isHarvestTask
} from './harvestTiming';
import { PRESERVING_METHODS } from './preserving';
import { HARVEST_TIMING_STAGES } from '$lib/plugins/schemas';

// #867 drying hint (rulings DH-1 to DH-8 in
// docs/design/phase-37-followups/drying-hint.md).

const rosemary = {
  harvestTiming: [
    { method: 'dry' as const, stage: 'before-bloom' as const },
    { method: 'freeze' as const, stage: 'bloom-begins' as const }
  ]
};

describe('harvestTimingHints', () => {
  it('keeps only the methods the brief names, in method order (DH-4)', () => {
    expect(harvestTimingHints(rosemary, ['dry'])).toEqual([
      { method: 'dry', stage: 'before-bloom' }
    ]);
    expect(harvestTimingHints(rosemary, ['freeze', 'dry'])).toEqual([
      { method: 'dry', stage: 'before-bloom' },
      { method: 'freeze', stage: 'bloom-begins' }
    ]);
  });

  it('judges pesto as freezing and never adds a line for canning', () => {
    expect(harvestTimingHints(rosemary, ['pesto'])).toEqual([
      { method: 'freeze', stage: 'bloom-begins' }
    ]);
    expect(harvestTimingHints(rosemary, ['can-or-jelly', 'fresh'])).toEqual([]);
  });

  it('has no default: no row, no line (DH-5)', () => {
    expect(harvestTimingHints({}, ['dry'])).toEqual([]);
    expect(harvestTimingHints(null, ['dry'])).toEqual([]);
    expect(harvestTimingHints(undefined, ['dry'])).toEqual([]);
    expect(harvestTimingHints(rosemary, [])).toEqual([]);
  });
});

describe('the words', () => {
  it('have English without a locale and Spanish for es, for every method and stage', () => {
    for (const m of PRESERVING_METHODS) {
      expect(harvestTimingLabel(m)).toMatch(/^For /);
      expect(harvestTimingLabel(m, 'es')).toMatch(/^Para /);
    }
    for (const s of HARVEST_TIMING_STAGES) {
      expect(harvestTimingText(s)).toMatch(/^Cut just .*\.$/);
      expect(harvestTimingText(s, 'es')).toMatch(/^Corta justo .*\.$/);
    }
    expect(harvestTimingLabel('dry')).toBe('For drying');
    expect(harvestTimingText('before-bloom')).toBe('Cut just before it flowers.');
    expect(harvestTimingText('bloom-begins')).toBe('Cut just as it starts to flower.');
    expect(harvestTimingText('before-bloom', 'en')).toBe(harvestTimingText('before-bloom'));
  });

  it('never claim a reason no source gave (DH-5)', () => {
    for (const s of HARVEST_TIMING_STAGES) {
      expect(harvestTimingText(s)).not.toMatch(/flavou?r|best|oil|aroma/i);
    }
  });
});

describe('isHarvestTask', () => {
  it('reads the category and the harvest template keys', () => {
    expect(isHarvestTask({ category: 'harvest' })).toBe(true);
    expect(isHarvestTask({ pluginTemplateKey: 'derived:pantry-cut:p1:2026-07-06' })).toBe(true);
    expect(isHarvestTask({ pluginTemplateKey: 'derived:harvest-window:b1:1783641600000' })).toBe(
      true
    );
    expect(isHarvestTask({ category: 'prune' })).toBe(false);
    expect(isHarvestTask({ pluginTemplateKey: 'derived:seasonal-task:b1:1' })).toBe(false);
    expect(isHarvestTask({ category: null, pluginTemplateKey: null })).toBe(false);
  });
});

describe('harvestTimingByPlanting', () => {
  const plugins: Record<string, typeof rosemary | undefined> = {
    'rosemary-tuscan-blue': rosemary,
    'thyme-german-winter': {} as typeof rosemary
  };
  const cropPluginOf = new Map([
    ['p_rose', 'rosemary-tuscan-blue'],
    ['p_thyme', 'thyme-german-winter']
  ]);
  const tasks = [
    { cropId: 'p_rose', category: 'harvest' },
    { cropId: 'p_thyme', category: 'harvest' },
    { cropId: 'p_rose', category: 'prune' },
    { cropId: null, category: 'harvest' },
    { cropId: 'p_gone', category: 'harvest' }
  ];

  it('keys hints by planting, leaving out plantings with none', () => {
    expect(harvestTimingByPlanting(tasks, cropPluginOf, (id) => plugins[id], ['dry'])).toEqual({
      p_rose: [{ method: 'dry', stage: 'before-bloom' }]
    });
  });

  it('is empty with no goals, and ignores plantings that only have other tasks', () => {
    expect(harvestTimingByPlanting(tasks, cropPluginOf, (id) => plugins[id], [])).toEqual({});
    expect(
      harvestTimingByPlanting(
        [{ cropId: 'p_rose', category: 'prune' }],
        cropPluginOf,
        (id) => plugins[id],
        ['dry']
      )
    ).toEqual({});
  });

  it('takes a one-shot iterable of goals', () => {
    const goals = new Set(['dry'] as const).values();
    expect(harvestTimingByPlanting(tasks, cropPluginOf, (id) => plugins[id], goals)).toEqual({
      p_rose: [{ method: 'dry', stage: 'before-bloom' }]
    });
  });
});
