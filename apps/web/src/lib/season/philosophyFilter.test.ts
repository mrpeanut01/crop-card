/**
 * Tests for the philosophy → product filter (Phase 21 / B-25).
 *
 * Covers the 4 philosophies × 3 representative flag combinations matrix
 * plus ruling OT-1: the fertilizer source-class field admits nothing.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
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
  philosophyProductClass,
  philosophyRejectionReason
} from './philosophyFilter';
import type { Philosophy } from './setup';

// Minimal valid herbicide shape with mutable complianceFlags. Real plugins
// carry many more fields but `isProductAllowed` only reads
// `complianceFlags` (+ `type`), so a partial shape is sufficient.
function herbicide(id: string, flags?: HerbicidePlugin['complianceFlags']): HerbicidePlugin {
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

function insecticide(id: string, flags?: InsecticidePlugin['complianceFlags']): InsecticidePlugin {
  return {
    pluginId: id,
    type: 'insecticide',
    displayName: id,
    activeIngredients: [{ name: 'spinosad' }],
    reEntryIntervalHours: 4,
    complianceFlags: flags
  } as unknown as InsecticidePlugin;
}

function fungicide(id: string, flags?: FungicidePlugin['complianceFlags']): FungicidePlugin {
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
    expect(isProductAllowed(insecticide('spinosad', { omriListed: true }), 'conventional')).toBe(
      true
    );
    expect(isProductAllowed(fungicide('copper', { omriListed: false }), 'conventional')).toBe(true);
    expect(isProductAllowed(fertilizer('urea', { organic: false }), 'conventional')).toBe(true);
  });
});

describe('isProductAllowed — no-till', () => {
  it('allows every product regardless of flags, burndown herbicides included', () => {
    expect(isProductAllowed(herbicide('roundup'), 'no-till')).toBe(true);
    expect(isProductAllowed(herbicide('gramoxone', { nonGmoCompliant: false }), 'no-till')).toBe(
      true
    );
    expect(isProductAllowed(fungicide('copper', { omriListed: false }), 'no-till')).toBe(true);
    expect(isProductAllowed(fertilizer('urea', { organic: false }), 'no-till')).toBe(true);
  });

  it('never produces a rejection reason', () => {
    expect(philosophyRejectionReason(herbicide('roundup'), 'no-till')).toBe('');
  });
});

describe('isProductAllowed — non-gmo', () => {
  it('requires nonGmoCompliant === true', () => {
    expect(isProductAllowed(herbicide('h1', { nonGmoCompliant: true }), 'non-gmo')).toBe(true);
  });

  it('rejects when flag is absent or false', () => {
    expect(isProductAllowed(herbicide('h2'), 'non-gmo')).toBe(false);
    expect(isProductAllowed(herbicide('h3', { nonGmoCompliant: false }), 'non-gmo')).toBe(false);
  });

  it('does not accept OMRI as a substitute for non-GMO', () => {
    expect(
      isProductAllowed(herbicide('h4', { omriListed: true, nonGmoCompliant: false }), 'non-gmo')
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
    expect(isProductAllowed(insecticide('i1', { omriListed: true }), 'organic-transitioning')).toBe(
      true
    );
  });

  it('rejects when both flags absent', () => {
    expect(isProductAllowed(herbicide('h2'), 'organic-transitioning')).toBe(false);
  });

  it('OT-1: does not admit a fertilizer on organic: true alone', () => {
    expect(
      isProductAllowed(fertilizer('compost', { organic: true }), 'organic-transitioning')
    ).toBe(false);
    expect(
      isProductAllowed(
        fertilizer('sulfur', { organic: false, flags: { transitioningAllowed: true } }),
        'organic-transitioning'
      )
    ).toBe(true);
  });

  it('rejects fertilizer with organic: false and no flags', () => {
    expect(isProductAllowed(fertilizer('urea', { organic: false }), 'organic-transitioning')).toBe(
      false
    );
  });
});

describe('isProductAllowed — certified-organic', () => {
  it('requires omriListed === true', () => {
    expect(isProductAllowed(insecticide('i1', { omriListed: true }), 'certified-organic')).toBe(
      true
    );
  });

  it('rejects when omriListed is absent or false', () => {
    expect(isProductAllowed(herbicide('h1'), 'certified-organic')).toBe(false);
    expect(isProductAllowed(herbicide('h2', { omriListed: false }), 'certified-organic')).toBe(
      false
    );
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
    expect(isProductAllowed(fertilizer('compost', { organic: true }), 'certified-organic')).toBe(
      false
    );
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
    expect(philosophyRejectionReason(herbicide('h1'), 'non-gmo')).toContain('nonGmoCompliant');
    expect(philosophyRejectionReason(herbicide('h2'), 'certified-organic')).toContain('OMRI');
    expect(
      philosophyRejectionReason(
        herbicide('h3', { omriListed: true, certifiedOrganicAllowed: false }),
        'certified-organic'
      )
    ).toContain('excluded');
  });
});

describe('isProductAllowed — B-18 shared organic reader', () => {
  it('organic-transitioning never offers a product marked not allowed', () => {
    expect(
      isProductAllowed(
        fertilizer('cottonseed', {
          organic: true,
          flags: { transitioningAllowed: true, certifiedOrganicAllowed: false }
        }),
        'organic-transitioning'
      )
    ).toBe(false);
    expect(
      isProductAllowed(
        insecticide('met52', { transitioningAllowed: true, certifiedOrganicAllowed: false }),
        'organic-transitioning'
      )
    ).toBe(false);
  });
});

const ALL_PHILOSOPHIES: Philosophy[] = [
  'conventional',
  'no-till',
  'non-gmo',
  'organic-transitioning',
  'certified-organic'
];

const REPO_ROOT = path.resolve(__dirname, '../../../../..');

function shippedFertilizers(): FertilizerPlugin[] {
  const dir = path.join(REPO_ROOT, 'plugins', 'fertilizers');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as FertilizerPlugin);
}

describe('OT-1: the fertilizer source class never decides a philosophy', () => {
  const flag = fc.option(fc.boolean(), { nil: undefined });
  const flags = fc.option(
    fc.record({
      omriListed: flag,
      certifiedOrganicAllowed: flag,
      transitioningAllowed: flag,
      nonGmoCompliant: flag
    }),
    { nil: undefined }
  );

  it('flipping organic changes no verdict, for any flags', () => {
    fc.assert(
      fc.property(flags, fc.constantFrom(...ALL_PHILOSOPHIES), (f, philosophy) => {
        const yes = fertilizer('x', { organic: true, flags: f });
        const no = fertilizer('x', { organic: false, flags: f });
        expect(isProductAllowed(yes, philosophy)).toBe(isProductAllowed(no, philosophy));
        expect(philosophyProductClass(yes, philosophy)).toBe(
          philosophyProductClass(no, philosophy)
        );
      })
    );
  });

  it('flipping organic changes no verdict for any shipped fertilizer', () => {
    for (const p of shippedFertilizers()) {
      for (const philosophy of ALL_PHILOSOPHIES) {
        expect(
          philosophyProductClass({ ...p, organic: !p.organic }, philosophy),
          `${p.pluginId} under ${philosophy}`
        ).toBe(philosophyProductClass(p, philosophy));
      }
    }
  });

  it('the filter and the organic readers contain no read of the field', () => {
    const files = [
      path.join(__dirname, 'philosophyFilter.ts'),
      path.join(__dirname, '../organic/inputCompliance.ts'),
      path.join(__dirname, '../server/inputsChoiceValidate.ts')
    ];
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\.organic\b/);
    }
  });

  it('every shipped fertilizer an organic-transitioning plan may choose has a sourced flag', () => {
    const sources = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'apps/web/scripts/fertilizer-organic-sources.json'), 'utf8')
    ) as Record<string, unknown>;
    const admitted = shippedFertilizers().filter((p) =>
      isProductAllowed(p, 'organic-transitioning')
    );
    expect(admitted.length).toBeGreaterThan(0);
    for (const p of admitted) {
      const f = p.complianceFlags;
      expect(f?.transitioningAllowed === true || f?.omriListed === true, p.pluginId).toBe(true);
      expect(sources[p.pluginId], p.pluginId).toBeDefined();
    }
  });
});

describe('philosophyProductClass (OT-1)', () => {
  it('a fertilizer marked neither way is not-marked for organic-transitioning only', () => {
    const compost = fertilizer('compost', { organic: true });
    expect(philosophyProductClass(compost, 'organic-transitioning')).toBe('not-marked');
    expect(philosophyProductClass(compost, 'certified-organic')).toBe('not-allowed');
    expect(philosophyProductClass(compost, 'non-gmo')).toBe('not-allowed');
    expect(philosophyProductClass(compost, 'conventional')).toBe('allowed');
  });

  it('a fertilizer marked not allowed stays not-allowed', () => {
    const urea = fertilizer('urea', { organic: false, flags: { certifiedOrganicAllowed: false } });
    expect(philosophyProductClass(urea, 'organic-transitioning')).toBe('not-allowed');
  });

  it('an unmarked pesticide is never offered for a pick by hand', () => {
    expect(philosophyProductClass(herbicide('h'), 'organic-transitioning')).toBe('not-allowed');
    expect(philosophyProductClass(insecticide('i'), 'organic-transitioning')).toBe('not-allowed');
    expect(philosophyProductClass(fungicide('f'), 'organic-transitioning')).toBe('not-allowed');
  });

  it('sourced flags read as allowed', () => {
    expect(
      philosophyProductClass(
        fertilizer('s', { organic: false, flags: { transitioningAllowed: true } }),
        'organic-transitioning'
      )
    ).toBe('allowed');
  });
});
