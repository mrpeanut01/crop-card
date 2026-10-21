import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { briefGoalsFrom, briefGoalsFromSetting } from './briefGoals';
import { goalLineText, preservedAsSuffix, preservingMethodLabel } from './pantryText';
import { BRIEF_STORAGE_GOALS, PRESERVING_METHODS } from './preserving';
import type { GoalLine } from './harvestSchedule';
import { en } from '$lib/i18n/catalogs/en';
import { es } from '$lib/i18n/catalogs/es';

describe('briefGoalsFrom', () => {
  it('reads goal objects under a storage field with their provenance', () => {
    expect(
      briefGoalsFrom({
        storageGoals: [
          { goal: 'dry', target: 'enough oregano for the year', provenance: 'manual' },
          { goal: 'pesto', provenance: 'ai' }
        ]
      })
    ).toEqual([
      { goal: 'dry', target: 'enough oregano for the year', provenance: 'manual' },
      { goal: 'pesto', target: null, provenance: 'ai' }
    ]);
  });

  it('reads a plain list nested in answers, once per goal, dropping unknowns', () => {
    expect(
      briefGoalsFrom({
        answers: { storage: { goals: ['freeze', 'pickle', 'freeze', { method: 'infuse' }] } }
      })
    ).toEqual([
      { goal: 'freeze', target: null, provenance: 'manual' },
      { goal: 'infuse', target: null, provenance: 'manual' }
    ]);
  });

  it('takes an answer-level provenance for its goals', () => {
    expect(briefGoalsFrom({ storage: { goals: ['dry'], provenance: 'fallback' } })).toEqual([
      { goal: 'dry', target: null, provenance: 'fallback' }
    ]);
  });

  it('a missing, broken or odd brief reads as no goals', () => {
    expect(briefGoalsFromSetting(undefined)).toEqual([]);
    expect(briefGoalsFromSetting('{not json')).toEqual([]);
    expect(briefGoalsFromSetting('42')).toEqual([]);
    expect(briefGoalsFrom({ storageGoals: 'dry' })).toEqual([]);
  });

  it('never throws and only returns known goals', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const out = briefGoalsFrom(v);
        for (const g of out) expect(BRIEF_STORAGE_GOALS).toContain(g.goal);
        expect(new Set(out.map((g) => g.goal)).size).toBe(out.length);
      })
    );
  });
});

describe('pantry text', () => {
  const line: GoalLine = {
    goal: 'freeze',
    target: null,
    method: 'freeze',
    status: 'on-track',
    reason: 'suitable-cut',
    cropPluginId: 'basil-genovese',
    suitability: 'fair',
    provenance: 'plugin'
  };
  const name = () => 'Basil';

  it('names the suitability on a fair goal (R-7) in English with no locale', () => {
    expect(goalLineText(line, name)).toBe('Freezing: On track. Basil freezes fairly well.');
    expect(goalLineText({ ...line, target: 'a dozen portions' }, name, 'en')).toBe(
      'Freezing: On track. Basil freezes fairly well. Your aim: a dozen portions'
    );
  });

  it('says canning needs a tested recipe and not known has no data', () => {
    const can: GoalLine = {
      goal: 'can-or-jelly',
      target: null,
      method: null,
      status: 'not-known',
      reason: 'needs-recipe',
      provenance: 'fallback'
    };
    expect(goalLineText(can, name)).toBe(
      'Canning and jelly: Not known. Plant data cannot answer this; use a tested recipe.'
    );
  });

  it('has Spanish for every method and the suffix', () => {
    for (const m of PRESERVING_METHODS) {
      expect(preservingMethodLabel(m, 'es')).not.toBe(preservingMethodLabel(m));
    }
    expect(preservedAsSuffix('dry')).toBe(', dried');
    expect(preservedAsSuffix('dry', 'es')).toBe(', secado');
    expect(goalLineText(line, name, 'es')).toBe(
      'Congelación: Va bien. Basil se congela bastante bien.'
    );
  });

  it('every herbsc key has a Spanish value', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('herbsc.'));
    expect(keys.length).toBeGreaterThan(50);
    for (const k of keys) expect((es as Record<string, string>)[k], k).toBeTruthy();
  });
});
