/**
 * Property-based tests for the safety kernel.
 *
 * Covers invariants the kernel must always uphold across the cartesian
 * product of inputs — the kind of edge cases hand-written tests miss.
 * If any of these regress, the kernel has a real bug.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHEMISTRY_KILL_MATRIX, CROP_FAMILIES, type CropFamily } from './cropFamilyLethality';
import { evaluateSpray } from './evaluate';
import { CHEMISTRY_CLASSES, type ChemistryClass, type SprayContext } from './types';

const chemistryClassArb = fc.constantFrom(...CHEMISTRY_CLASSES);
const cropFamilyArb = fc.constantFrom(...CROP_FAMILIES);

const productArb = fc.record({
  pluginId: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => /^[a-z0-9-]+$/.test(s)),
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

const conditionsArb = fc.record({
  windMph: fc.float({ min: Math.fround(0), max: Math.fround(40), noNaN: true }),
  tempF: fc.float({ min: Math.fround(20), max: Math.fround(110), noNaN: true }),
  rainForecastMmNext24h: fc.float({ min: Math.fround(0), max: Math.fround(20), noNaN: true })
});

const sprayerArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  lastChemistryClass: fc.option(chemistryClassArb, { nil: undefined })
});

const ctxArb: fc.Arbitrary<SprayContext> = fc.record({
  occurredAt: fc.integer({ min: 1_000_000_000_000, max: 2_000_000_000_000 }),
  products: fc.array(productArb, { minLength: 1, maxLength: 3 }),
  crop: cropArb,
  coPlantedCrops: fc.array(cropArb, { minLength: 0, maxLength: 3 }),
  sprayer: sprayerArb,
  conditions: conditionsArb
});

function chemistryClassesIn(ctx: SprayContext): Set<ChemistryClass> {
  return new Set(ctx.products.flatMap((p) => p.activeIngredients.map((ai) => ai.chemistryClass)));
}

function cropFamiliesIn(ctx: SprayContext): Set<CropFamily> {
  const families = new Set<CropFamily>();
  if (ctx.crop.cropFamily) families.add(ctx.crop.cropFamily);
  for (const c of ctx.coPlantedCrops ?? []) {
    if (c.cropFamily) families.add(c.cropFamily);
  }
  return families;
}

describe('safety kernel — invariants', () => {
  it('never returns ok=true when a product chemistry class kills any crop family in the block', () => {
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        const result = evaluateSpray(ctx);
        const classes = chemistryClassesIn(ctx);
        const families = cropFamiliesIn(ctx);
        const lethal = [...classes].some((cls) =>
          [...families].some((fam) => CHEMISTRY_KILL_MATRIX[cls].killsFamilies.includes(fam))
        );
        if (lethal) {
          expect(result.ok).toBe(false);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('never claims ok=true alongside any violation', () => {
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        const r = evaluateSpray(ctx);
        if (r.ok) {
          expect(r.violations).toEqual([]);
          expect(r.requiresDecon).toBe(false);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('flags requiresDecon iff sprayer last chemistry differs from planned and no decon recorded', () => {
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        const r = evaluateSpray(ctx);
        if (r.requiresDecon) {
          const last = ctx.sprayer.lastChemistryClass;
          expect(last).toBeDefined();
          const planned = chemistryClassesIn(ctx);
          expect(planned.has(last as ChemistryClass)).toBe(false);
        }
      }),
      { numRuns: 500 }
    );
  });

  it('is order-insensitive across product permutations', () => {
    fc.assert(
      fc.property(ctxArb, (ctx) => {
        const a = evaluateSpray(ctx);
        const reversed: SprayContext = { ...ctx, products: [...ctx.products].reverse() };
        const b = evaluateSpray(reversed);
        expect(a.ok).toBe(b.ok);
        expect(a.requiresDecon).toBe(b.requiresDecon);
        // Same set of violation codes, regardless of order.
        const codes = (out: typeof a) => out.violations.map((v) => v.code).sort();
        expect(codes(a)).toEqual(codes(b));
      }),
      { numRuns: 300 }
    );
  });

  it('synthetic-auxin over corn taller than 8 inches always blocks', () => {
    fc.assert(
      fc.property(
        fc.record({
          height: fc.integer({ min: 9, max: 96 }),
          windMph: fc.float({ min: Math.fround(1), max: Math.fround(8), noNaN: true })
        }),
        ({ height, windMph }) => {
          const ctx: SprayContext = {
            occurredAt: 1_700_000_000_000,
            products: [
              {
                pluginId: '24d',
                displayName: '2,4-D',
                activeIngredients: [{ name: '2,4-D', chemistryClass: 'synthetic-auxin' }]
              }
            ],
            crop: { cropPluginId: 'corn-bb', cropFamily: 'corn', heightInches: height },
            sprayer: { id: 'CORN' },
            conditions: { windMph, tempF: 70, rainForecastMmNext24h: 0 }
          };
          const r = evaluateSpray(ctx);
          expect(r.ok).toBe(false);
          expect(r.violations.some((v) => v.code === 'CROP_STAGE_BLOCK')).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });
});
