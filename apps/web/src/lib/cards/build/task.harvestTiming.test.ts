import { describe, expect, it } from 'vitest';
import { buildTaskCard, buildTaskCardFromSnapshot } from './task';
import { sampleSnapshot } from './fixtures';
import type { FarmSnapshot } from '../snapshot';

// #867 drying hint on harvest task cards (DH-4, DH-7).

const prefs = { timeZone: 'America/New_York', units: 'us' as const };
const now = Date.parse('2026-07-10T16:00:00Z');
const dry = [{ method: 'dry' as const, stage: 'before-bloom' as const }];
const DRY_FACT = { label: 'For drying', value: 'Cut just before it flowers.', provenance: 'plugin' };

const harvest = {
  id: 't_cut',
  title: 'Cut basil',
  category: 'harvest' as const,
  scheduledFor: Date.parse('2026-07-10T14:00:00Z'),
  cropId: 'p_basil'
};

describe('the timing fact on a live task card', () => {
  it('shows on an open harvest task, tagged plugin', () => {
    const card = buildTaskCard(harvest, { asOf: now, harvestTiming: dry }, { now, prefs });
    expect(card.facts).toContainEqual(DRY_FACT);
  });

  it('counts a pantry cut and a scheduled harvest window as harvest tasks', () => {
    for (const pluginTemplateKey of [
      'derived:pantry-cut:p_basil:2026-07-06',
      'derived:harvest-window:b1:1783641600000'
    ]) {
      const task = { ...harvest, category: null, pluginTemplateKey };
      const card = buildTaskCard(task, { asOf: now, harvestTiming: dry }, { now, prefs });
      expect(card.facts, pluginTemplateKey).toContainEqual(DRY_FACT);
    }
  });

  it('never shows on another kind of task, a closed one or without hints', () => {
    const prune = { ...harvest, category: 'prune' as const };
    expect(buildTaskCard(prune, { asOf: now, harvestTiming: dry }, { now, prefs }).facts).not.toContainEqual(
      DRY_FACT
    );
    const done = { ...harvest, completedAt: now - 1000 };
    expect(buildTaskCard(done, { asOf: now, harvestTiming: dry }, { now, prefs }).facts).not.toContainEqual(
      DRY_FACT
    );
    const skipped = { ...harvest, abortedAt: now - 1000 };
    expect(
      buildTaskCard(skipped, { asOf: now, harvestTiming: dry }, { now, prefs }).facts
    ).not.toContainEqual(DRY_FACT);
    const bare = buildTaskCard(harvest, { asOf: now }, { now, prefs });
    expect(bare.facts.map((f) => f.label)).not.toContain('For drying');
  });

  it('reads in Spanish', () => {
    const card = buildTaskCard(
      harvest,
      { asOf: now, harvestTiming: [{ method: 'dry', stage: 'bloom-begins' }] },
      { now, prefs, locale: 'es' }
    );
    expect(card.facts).toContainEqual({
      label: 'Para secar',
      value: 'Corta justo cuando empiece a florecer.',
      provenance: 'plugin'
    });
  });
});

describe('the timing fact on an offline task card', () => {
  function withBasil(goals: Array<'dry' | 'fresh' | 'pesto'>, timing = dry): FarmSnapshot {
    const snap = sampleSnapshot();
    return {
      ...snap,
      plantings: [
        ...snap.plantings,
        { ...snap.plantings[0], id: 'p_basil', cropPluginId: 'basil-genovese', varietyDisplayName: 'Genovese basil' }
      ],
      tasks: [
        ...snap.tasks,
        {
          id: 't_cut',
          title: 'Cut basil',
          category: 'harvest',
          scheduledFor: Date.parse('2026-07-10T12:00:00Z'),
          cropId: 'p_basil',
          blockId: 'b_bed3',
          equipmentId: null
        }
      ],
      cropPlugins: {
        ...snap.cropPlugins,
        'basil-genovese': {
          pluginId: 'basil-genovese',
          displayName: 'Basil — Genovese',
          version: '1.0.2',
          cropFamily: 'herb-culinary',
          harvestTiming: timing
        }
      },
      pantry: {
        year: 2026,
        kept: [],
        goals: goals.map((goal) => ({
          goal,
          target: null,
          method: goal === 'pesto' ? 'freeze' : goal,
          status: 'not-known' as const,
          reason: 'no-data' as const,
          provenance: 'fallback' as const
        }))
      }
    };
  }

  it('shows when the bundle carries the crop row and a drying goal', () => {
    const card = buildTaskCardFromSnapshot(withBasil(['dry']), 't_cut', { prefs, now })!;
    expect(card.facts).toContainEqual(DRY_FACT);
  });

  it('stays off without a goal for the method, without a pantry part or without the row', () => {
    const fresh = buildTaskCardFromSnapshot(withBasil(['fresh', 'pesto']), 't_cut', { prefs, now })!;
    expect(fresh.facts.map((f) => f.label)).not.toContain('For drying');
    const noPantry = { ...withBasil(['dry']), pantry: undefined };
    expect(
      buildTaskCardFromSnapshot(noPantry, 't_cut', { prefs, now })!.facts.map((f) => f.label)
    ).not.toContain('For drying');
    const thymeLike = withBasil(['dry'], []);
    expect(
      buildTaskCardFromSnapshot(thymeLike, 't_cut', { prefs, now })!.facts.map((f) => f.label)
    ).not.toContain('For drying');
  });
});
