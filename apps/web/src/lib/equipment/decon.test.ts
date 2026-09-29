import { describe, expect, it } from 'vitest';
import { needsDecon } from './decon';

describe('needsDecon', () => {
  it('flags a sprayer that carried chemistry after its last decon', () => {
    expect(needsDecon({ lastChemistryClass: 'auxin', lastUsedAt: 10 })).toBe(true);
    expect(needsDecon({ lastChemistryClass: 'auxin', lastUsedAt: 10, lastDeconAt: 5 })).toBe(true);
  });
  it('clears once deconned at or after the last use, or with no load', () => {
    expect(needsDecon({ lastChemistryClass: 'auxin', lastUsedAt: 10, lastDeconAt: 10 })).toBe(
      false
    );
    expect(needsDecon({ lastChemistryClass: null, lastUsedAt: 10 })).toBe(false);
    expect(needsDecon({ lastChemistryClass: 'auxin' })).toBe(false);
    expect(needsDecon(null)).toBe(false);
  });
});

describe('layout decon banner placement (#470)', () => {
  it('stays off /today, which has its own cleanout card', async () => {
    const { showLayoutDeconBanner } = await import('./decon');
    expect(showLayoutDeconBanner('/today', 1)).toBe(false);
    expect(showLayoutDeconBanner('/plan', 1)).toBe(true);
    expect(showLayoutDeconBanner('/plan', 0)).toBe(false);
  });
});
