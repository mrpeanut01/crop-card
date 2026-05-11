/**
 * Tests for the data-augmented safety hook.
 *
 * Hard invariant: a kernel verdict can only be MADE STRICTER by user-added
 * restrictions, never relaxed. The fast-check property at the bottom of the
 * file proves this across the cartesian product of inputs.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CROP_FAMILIES } from './cropFamilyLethality';
import { evaluateSpray } from './evaluate';
import { CHEMISTRY_CLASSES, type SafetyResult, type SprayContext } from './types';
import { augmentSafetyResult, type UserAddedRestriction } from './userAddedRestrictions';

const baseCtx = (overrides: Partial<SprayContext> = {}): SprayContext => ({
  occurredAt: Date.UTC(2026, 4, 1),
  products: [
    {
      pluginId: 'roundup-powermax',
      displayName: 'Roundup PowerMax',
      activeIngredients: [{ name: 'Glyphosate', chemistryClass: 'glyphosate' }]
    }
  ],
  crop: { cropPluginId: 'corn-bb', cropFamily: 'corn', heightInches: 6 },
  sprayer: { id: 'sprayer-a' },
  conditions: { windMph: 5, tempF: 70, rainForecastMmNext24h: 0 },
  ...overrides
});

describe('augmentSafetyResult — explicit cases', () => {
  it('preserves a clean kernel result when no restrictions match', () => {
    const ctx = baseCtx({
      crop: { cropPluginId: 'soy', cropFamily: 'legume' }
    });
    const base = evaluateSpray(ctx);
    expect(base.ok).toBe(false); // glyphosate kills legume — kernel already blocks

    const augmented = augmentSafetyResult(base, ctx, []);
    expect(augmented).toBe(base);
  });

  it('returns base verbatim when restrictions list is empty', () => {
    const ctx = baseCtx();
    const base = evaluateSpray(ctx);
    const augmented = augmentSafetyResult(base, ctx, []);
    expect(augmented).toBe(base);
  });

  it('adds a CROP_INCOMPATIBLE violation when chemistry class matches a blocked family', () => {
    const ctx = baseCtx();
    const kernel: SafetyResult = { ok: true, violations: [], requiresDecon: false };

    const restrictions: UserAddedRestriction[] = [
      {
        kind: 'chemistry-not-on-crop',
        match: { type: 'chemistryClass', value: 'glyphosate' },
        blocksWhenCropFamily: ['corn'],
        source: 'user-stock',
        sourceRef: 'stk_test',
        reason: 'User-added stock blocks glyphosate over corn (no trait override).'
      }
    ];

    const augmented = augmentSafetyResult(kernel, ctx, restrictions);
    expect(augmented.ok).toBe(false);
    expect(augmented.violations).toHaveLength(1);
    expect(augmented.violations[0].code).toBe('CROP_INCOMPATIBLE');
    expect(augmented.violations[0].detail?.source).toBe('user-added');
    expect(augmented.requiresDecon).toBe(true);
  });

  it('blocks via co-planted crop family when primary crop is unaffected', () => {
    const ctx = baseCtx({
      crop: { cropPluginId: 'corn-bb', cropFamily: 'corn' },
      coPlantedCrops: [{ cropPluginId: 'beans', cropFamily: 'legume' }]
    });
    const kernelClean: SafetyResult = { ok: true, violations: [], requiresDecon: false };

    const restrictions: UserAddedRestriction[] = [
      {
        kind: 'chemistry-not-on-crop',
        match: { type: 'chemistryClass', value: 'glyphosate' },
        blocksWhenCropFamily: ['legume'],
        source: 'plugin',
        sourceRef: 'roundup-powermax',
        reason: 'Glyphosate kills legumes co-planted with corn.'
      }
    ];

    const augmented = augmentSafetyResult(kernelClean, ctx, restrictions);
    expect(augmented.ok).toBe(false);
    expect(augmented.violations[0].detail?.matchedCropFamily).toBe('legume');
  });

  it('universal block (empty blocksWhenCropFamily) fires regardless of crop family', () => {
    const ctx = baseCtx();
    const kernel: SafetyResult = { ok: true, violations: [], requiresDecon: false };

    const restrictions: UserAddedRestriction[] = [
      {
        kind: 'product-not-on-crop',
        match: { type: 'productPluginId', value: 'roundup-powermax' },
        blocksWhenCropFamily: [],
        source: 'user-stock',
        sourceRef: 'stk_xyz',
        reason: 'Operator marked this lot as expired-do-not-spray.'
      }
    ];

    const augmented = augmentSafetyResult(kernel, ctx, restrictions);
    expect(augmented.ok).toBe(false);
    expect(augmented.violations[0].detail?.matchedCropFamily).toBe('*');
  });

  it('match by active-ingredient name fires correctly (case-insensitive)', () => {
    const ctx = baseCtx();
    const kernel: SafetyResult = { ok: true, violations: [], requiresDecon: false };

    const restrictions: UserAddedRestriction[] = [
      {
        kind: 'chemistry-not-on-crop',
        match: { type: 'productActiveIngredientName', value: 'glyphosate' },
        blocksWhenCropFamily: ['corn'],
        source: 'user-stock',
        sourceRef: 'stk_x',
        reason: 'Active ingredient match'
      }
    ];

    const augmented = augmentSafetyResult(kernel, ctx, restrictions);
    expect(augmented.ok).toBe(false);
  });

  it('non-matching restriction is a no-op', () => {
    const ctx = baseCtx();
    const kernel: SafetyResult = { ok: true, violations: [], requiresDecon: false };
    const restrictions: UserAddedRestriction[] = [
      {
        kind: 'chemistry-not-on-crop',
        match: { type: 'chemistryClass', value: 'paraquat' as never }, // not in active products
        blocksWhenCropFamily: ['corn'],
        source: 'user-stock',
        sourceRef: 'stk_unused',
        reason: 'Should not fire'
      }
    ];

    const augmented = augmentSafetyResult(kernel, ctx, restrictions);
    expect(augmented.ok).toBe(true);
    expect(augmented.violations).toHaveLength(0);
  });
});

// ─── Property test — the load-bearing invariant ─────────────────────────

const chemistryClassArb = fc.constantFrom(...CHEMISTRY_CLASSES);
const cropFamilyArb = fc.constantFrom(...CROP_FAMILIES);

const productArb = fc.record({
  pluginId: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => /^[a-z0-9-]+$/.test(s) && s.length > 0),
  displayName: fc.string({ minLength: 1, maxLength: 24 }),
  activeIngredients: fc.array(
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 24 }),
      chemistryClass: chemistryClassArb
    }),
    { minLength: 1, maxLength: 3 }
  )
});

const cropArb = fc.record({
  cropPluginId: fc.string({ minLength: 1, maxLength: 24 }),
  cropFamily: cropFamilyArb,
  heightInches: fc.option(fc.integer({ min: 0, max: 96 }), { nil: undefined })
});

const ctxArb: fc.Arbitrary<SprayContext> = fc.record({
  occurredAt: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
  products: fc.array(productArb, { minLength: 1, maxLength: 3 }),
  crop: cropArb,
  coPlantedCrops: fc.array(cropArb, { minLength: 0, maxLength: 3 }),
  sprayer: fc.record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    lastChemistryClass: fc.option(chemistryClassArb, { nil: undefined })
  }),
  conditions: fc.record({
    windMph: fc.float({ min: Math.fround(0), max: Math.fround(40), noNaN: true }),
    tempF: fc.float({ min: Math.fround(20), max: Math.fround(110), noNaN: true }),
    rainForecastMmNext24h: fc.float({ min: Math.fround(0), max: Math.fround(20), noNaN: true })
  })
});

const restrictionArb: fc.Arbitrary<UserAddedRestriction> = fc.record({
  kind: fc.constantFrom('chemistry-not-on-crop' as const, 'product-not-on-crop' as const, 'pollinator-risk' as const),
  match: fc.oneof(
    fc.record({ type: fc.constant('chemistryClass' as const), value: chemistryClassArb }),
    fc.record({ type: fc.constant('productPluginId' as const), value: fc.string({ minLength: 1, maxLength: 12 }) }),
    fc.record({ type: fc.constant('productActiveIngredientName' as const), value: fc.string({ minLength: 1, maxLength: 24 }) })
  ),
  blocksWhenCropFamily: fc.array(cropFamilyArb, { minLength: 0, maxLength: 4 }),
  source: fc.constantFrom('user-stock' as const, 'plugin' as const, 'system-default' as const),
  sourceRef: fc.string({ minLength: 1, maxLength: 16 }),
  reason: fc.string({ minLength: 1, maxLength: 80 })
});

describe('augmentSafetyResult — invariants', () => {
  it('augmented.ok is never weaker than base.ok (false→true is impossible)', () => {
    fc.assert(
      fc.property(ctxArb, fc.array(restrictionArb, { maxLength: 5 }), (ctx, restrictions) => {
        const base = evaluateSpray(ctx);
        const augmented = augmentSafetyResult(base, ctx, restrictions);
        // If base was already false, augmented must remain false.
        if (!base.ok) expect(augmented.ok).toBe(false);
        // augmented.ok implies base.ok (contrapositive of the above).
        if (augmented.ok) expect(base.ok).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  it('augmented.violations.length ≥ base.violations.length, every base violation preserved', () => {
    fc.assert(
      fc.property(ctxArb, fc.array(restrictionArb, { maxLength: 5 }), (ctx, restrictions) => {
        const base = evaluateSpray(ctx);
        const augmented = augmentSafetyResult(base, ctx, restrictions);
        expect(augmented.violations.length).toBeGreaterThanOrEqual(base.violations.length);
        for (const v of base.violations) {
          expect(augmented.violations).toContain(v);
        }
      }),
      { numRuns: 200 }
    );
  });

  it('augmented.requiresDecon is never weaker than base.requiresDecon', () => {
    fc.assert(
      fc.property(ctxArb, fc.array(restrictionArb, { maxLength: 5 }), (ctx, restrictions) => {
        const base = evaluateSpray(ctx);
        const augmented = augmentSafetyResult(base, ctx, restrictions);
        if (base.requiresDecon) expect(augmented.requiresDecon).toBe(true);
      }),
      { numRuns: 200 }
    );
  });
});
