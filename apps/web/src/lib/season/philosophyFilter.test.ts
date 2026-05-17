/**
 * Tests for the philosophy → product filter (Phase 21 / B-25).
 *
 * Covers the 4 philosophies × 3 representative flag combinations matrix
 * plus the fertilizer `organic: true` escape for the transitioning case.
 */

import { describe, expect, it } from 'vitest';

import type {
  FertilizerPlugin,
  HerbicidePlugin,
  InsecticidePlugin,
  FungicidePlugin
} from '$lib/plugins/schemas';

import {
  filterByPhilosophy,
  isProductAllowed,
  philosophyRejectionReason
} from './philosophyFilter';

// Minimal valid herbicide shape with mutable complianceFlags. Real plugins
// carry many more fields but `isProductAllowed` only reads
// `complianceFlags` (+ `type` + `organic` for fertilizers), so a partial
// shape is sufficient.
function herbicide(
  id: string,
  flags?: HerbicidePlugin['complianceFlags']
): HerbicidePlugin {
  return {
    pluginId: id,
    type: 'herbicide',
    displayName: id,
    activeIngredients: [{ name: 'glyphosate', chemistryClass: 'glyphosate' }],
    ratePerAcre: { amount: 1, unit: 'qt' },
    gpaCalibration: 15,
    complianceFlags: flags
  } as unknown as HerbicidePlugin;
}

function insecticide(
  id: string,
  flags?: InsecticidePlugin['complianceFlags']
): InsecticidePlugin {
  return {
    pluginId: id,
    type: 'insecticide',
    displayName: id,
    activeIngredients: [{ name: 'spinosad' }],
    reEntryIntervalHours: 4,
    complianceFlags: flags
  } as unknown as InsecticidePlugin;
}

function fungicide(
  id: string,
  flags?: FungicidePlugin['complianceFlags']
): FungicidePlugin {
  return {
    pluginId: id,
    type: 'fungicide',
    displayName: id,
    activeIngredients: [{ name: 'copper hydroxide', fracCode: 'M01' }],
    ratePerAcre: { amount: 1, unit: 'lb' },
    gpaCalibration: 15,
    reEntryIntervalHours: 12,
    preHarvestIntervalDays: 0,
    complianceFlags: flags
  } as unknown as FungicidePlugin;
}

function fertilizer(
  id: string,
  opts: { organic: boolean; flags?: FertilizerPlugin['complianceFlags'] }
): FertilizerPlugin {
  return {
    pluginId: id,
    type: 'fertilizer',
    displayName: id,
    analysis: { n: 5, p: 5, k: 5 },
    form: 'compost',
    organic: opts.organic,
    complianceFlags: opts.flags
  } as unknown as FertilizerPlugin;
}

describe('isProductAllowed — conventional', () => {
  it('allows every product regardless of flags', () => {
    expect(isProductAllowed(herbicide('roundup'), 'conventional')).toBe(true);
    expect(
      isProductAllowed(insecticide('spinosad', { omriListed: true }), 'conventional')
    ).toBe(true);
    expect(
      isProductAllowed(fungicide('copper', { omriListed: false }), 'conventional')
    ).toBe(true);
    expect(
      isProductAllowed(fertilizer('urea', { organic: false }), 'conventional')
    ).toBe(true);
  });
});

describe('isProductAllowed — non-gmo', () => {
  it('requires nonGmoCompliant === true', () => {
    expect(
      isProductAllowed(herbicide('h1', { nonGmoCompliant: true }), 'non-gmo')
    ).toBe(true);
  });

  it('rejects when flag is absent or false', () => {
    expect(isProductAllowed(herbicide('h2'), 'non-gmo')).toBe(false);
    expect(
      isProductAllowed(herbicide('h3', { nonGmoCompliant: false }), 'non-gmo')
    ).toBe(false);
  });

  it('does not accept OMRI as a substitute for non-GMO', () => {
    expect(
      isProductAllowed(
        herbicide('h4', { omriListed: true, nonGmoCompliant: false }),
        'non-gmo'
      )
    ).toBe(false);
  });
});

describe('isProductAllowed — organic-transitioning', () => {
  it('accepts transitioningAllowed === true', () => {
    expect(
      isProductAllowed(herbicide('h1', { transitioningAllowed: true }), 'organic-transitioning')
    ).toBe(true);
  });

  it('accepts omriListed === true', () => {
    expect(
      isProductAllowed(insecticide('i1', { omriListed: true }), 'organic-transitioning')
    ).toBe(true);
  });

  it('rejects when both flags absent', () => {
    expect(isProductAllowed(herbicide('h2'), 'organic-transitioning')).toBe(false);
  });

  it('accepts fertilizer with organic: true even without complianceFlags', () => {
    expect(
      isProductAllowed(fertilizer('compost', { organic: true }), 'organic-transitioning')
    ).toBe(true);
  });

  it('rejects fertilizer with organic: false and no flags', () => {
    expect(
      isProductAllowed(fertilizer('urea', { organic: false }), 'organic-transitioning')
    ).toBe(false);
  });
});

describe('isProductAllowed — certified-organic', () => {
  it('requires omriListed === true', () => {
    expect(
      isProductAllowed(insecticide('i1', { omriListed: true }), 'certified-organic')
    ).toBe(true);
  });

  it('rejects when omriListed is absent or false', () => {
    expect(isProductAllowed(herbicide('h1'), 'certified-organic')).toBe(false);
    expect(
      isProductAllowed(herbicide('h2', { omriListed: false }), 'certified-organic')
    ).toBe(false);
  });

  it('rejects even with omriListed when certifiedOrganicAllowed === false', () => {
    expect(
      isProductAllowed(
        herbicide('h3', { omriListed: true, certifiedOrganicAllowed: false }),
        'certified-organic'
      )
    ).toBe(false);
  });

  it('does not honor fertilizer organic flag alone (NOP-strict)', () => {
    expect(
      isProductAllowed(fertilizer('compost', { organic: true }), 'certified-organic')
    ).toBe(false);
  });
});

describe('filterByPhilosophy', () => {
  it('returns only the allowed subset and preserves order', () => {
    const a = herbicide('a', { omriListed: true });
    const b = herbicide('b');
    const c = herbicide('c', { omriListed: true });
    const result = filterByPhilosophy([a, b, c], 'certified-organic');
    expect(result.map((p) => p.pluginId)).toEqual(['a', 'c']);
  });
});

describe('philosophyRejectionReason', () => {
  it('returns a non-empty reason for excluded products', () => {
    expect(
      philosophyRejectionReason(herbicide('h1'), 'non-gmo')
    ).toContain('nonGmoCompliant');
    expect(
      philosophyRejectionReason(herbicide('h2'), 'certified-organic')
    ).toContain('OMRI');
    expect(
      philosophyRejectionReason(
        herbicide('h3', { omriListed: true, certifiedOrganicAllowed: false }),
        'certified-organic'
      )
    ).toContain('excluded');
  });
});
