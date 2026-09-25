import { describe, expect, it } from 'vitest';
import { reHarvestArchetype, reHarvestLabel } from './reHarvest';

describe('reHarvestArchetype (#196 / #197 follow-up)', () => {
  it('allows repeat picks for the three multi-pick archetypes', () => {
    expect(reHarvestArchetype({ archetype: 'cut-and-come-again-leafy' })).toBe(
      'cut-and-come-again-leafy'
    );
    expect(reHarvestArchetype({ archetype: 'continuous-harvest-fruit' })).toBe(
      'continuous-harvest-fruit'
    );
    expect(reHarvestArchetype({ archetype: 'tree-fruit-multi-pick' })).toBe(
      'tree-fruit-multi-pick'
    );
  });

  it('keys off the explicit archetype, not the legacy harvestStyle', () => {
    expect(
      reHarvestArchetype({ archetype: 'continuous-harvest-fruit', harvestStyle: 'single-event' })
    ).toBe('continuous-harvest-fruit');
    expect(
      reHarvestArchetype({ archetype: 'row-grain.pollination', harvestStyle: 'cut-and-come-again' })
    ).toBeNull();
  });

  it('honours the planting-level archetype override in both directions', () => {
    expect(
      reHarvestArchetype({
        archetype: 'winter-squash-cure',
        archetypeOverride: 'continuous-harvest-fruit'
      })
    ).toBe('continuous-harvest-fruit');
    expect(
      reHarvestArchetype({
        archetype: 'cut-and-come-again-leafy',
        archetypeOverride: 'winter-squash-cure'
      })
    ).toBeNull();
  });

  it('falls back to the legacy harvestStyle when no archetype is declared', () => {
    expect(reHarvestArchetype({ harvestStyle: 'cut-and-come-again' })).toBe(
      'cut-and-come-again-leafy'
    );
  });

  it('refuses single-event archetypes', () => {
    expect(reHarvestArchetype({ archetype: 'small-grain.zadoks' })).toBeNull();
    expect(reHarvestArchetype({ archetype: 'forage-cutting-cycle' })).toBeNull();
  });

  it('labels each re-harvest archetype in operator language', () => {
    expect(reHarvestLabel('cut-and-come-again-leafy')).toBe('cut-and-come-again');
    expect(reHarvestLabel('tree-fruit-multi-pick')).toBe('tree-fruit multi-pick');
  });
});
