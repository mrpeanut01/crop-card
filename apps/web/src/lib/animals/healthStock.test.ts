import { describe, expect, it } from 'vitest';
import { doseUnitFor, isHealthStock } from './healthStock';

describe('isHealthStock (#649)', () => {
  const healthPlugin = (id: string) => id === 'safe-guard-suspension';

  it('keeps animal-health bottles and items linked to an animal-health plugin', () => {
    expect(isHealthStock({ category: 'animal-health' }, healthPlugin)).toBe(true);
    expect(
      isHealthStock({ category: 'adjuvant', pluginId: 'safe-guard-suspension' }, healthPlugin)
    ).toBe(true);
  });

  it('leaves out seed, crop pesticides, fertilizer and feed', () => {
    for (const category of [
      'seed',
      'herbicide',
      'insecticide',
      'fungicide',
      'fertilizer',
      'feed'
    ]) {
      expect(isHealthStock({ category, pluginId: 'stinger' }, healthPlugin)).toBe(false);
    }
  });
});

describe('doseUnitFor (#648)', () => {
  it('shows a stock unit the way the dose unit list does', () => {
    expect(doseUnitFor('ml')).toBe('mL');
    expect(doseUnitFor('fl-oz')).toBe('fl-oz');
    expect(doseUnitFor('count')).toBe('count');
  });
});
