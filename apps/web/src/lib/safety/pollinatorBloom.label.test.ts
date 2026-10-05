import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  checkPollinatorBloom,
  effectivePollinatorRisk,
  isRiskyForBloom,
  riskFromLabel,
  type CropInBlock,
  type LabelPollinator,
  type PollinatorRisk,
  type SprayedProduct
} from './pollinatorBloom';
import type { BeeToxicity, BloomRestriction } from './pollinatorProtection';
import { fungicidePluginSchema } from '$lib/plugins/schemas';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 15);
const BLOOMING: CropInBlock = {
  cropPluginId: 'squash',
  plantedAt: NOW - 45 * DAY,
  bloomWindow: { continuous: true }
};
const NOT_BLOOMING: CropInBlock = {
  cropPluginId: 'garlic',
  plantedAt: NOW - 45 * DAY
};

const RISKS: PollinatorRisk[] = ['none', 'low', 'moderate', 'high', 'unknown'];
const LEGACY: (PollinatorRisk | undefined)[] = [...RISKS, undefined];
const TOX: BeeToxicity[] = ['highly-toxic', 'toxic', 'relatively-nontoxic', 'unknown'];
const RESTRICTIONS: BloomRestriction[] = ['prohibited-during-bloom', 'dusk-to-dawn-only', 'none'];
const RANK: Record<PollinatorRisk, number> = { none: 0, low: 1, moderate: 2, unknown: 3, high: 4 };
const risky = (r: PollinatorRisk) => r === 'moderate' || r === 'high' || r === 'unknown';

const LABELS: (LabelPollinator | undefined)[] = [
  undefined,
  ...TOX.flatMap((beeToxicity) =>
    RESTRICTIONS.map((bloomRestriction) => ({ beeToxicity, bloomRestriction }))
  )
];
const ALL_PRODUCTS: SprayedProduct[] = LEGACY.flatMap((pollinatorRisk) =>
  LABELS.map((pollinator) => ({ pluginId: 'p', pollinatorRisk, pollinator }))
);

describe('riskFromLabel', () => {
  const table: [BeeToxicity, BloomRestriction, PollinatorRisk | undefined][] = [
    ['highly-toxic', 'none', 'high'],
    ['highly-toxic', 'dusk-to-dawn-only', 'high'],
    ['highly-toxic', 'prohibited-during-bloom', 'high'],
    ['toxic', 'none', 'moderate'],
    ['toxic', 'dusk-to-dawn-only', 'moderate'],
    ['toxic', 'prohibited-during-bloom', 'moderate'],
    ['relatively-nontoxic', 'none', 'low'],
    ['relatively-nontoxic', 'dusk-to-dawn-only', 'moderate'],
    ['relatively-nontoxic', 'prohibited-during-bloom', 'moderate'],
    ['unknown', 'none', undefined],
    ['unknown', 'dusk-to-dawn-only', 'unknown'],
    ['unknown', 'prohibited-during-bloom', 'unknown']
  ];
  it.each(table)('%s + %s → %s', (beeToxicity, bloomRestriction, want) => {
    expect(riskFromLabel({ beeToxicity, bloomRestriction })).toBe(want);
  });

  it('every label that restricts bloom gates in bloom', () => {
    for (const beeToxicity of TOX) {
      for (const bloomRestriction of RESTRICTIONS.filter((r) => r !== 'none')) {
        const r = riskFromLabel({ beeToxicity, bloomRestriction });
        expect(r !== undefined && risky(r)).toBe(true);
      }
    }
  });
});

describe('effectivePollinatorRisk (exhaustive)', () => {
  it.each(ALL_PRODUCTS.map((p) => [JSON.stringify(p), p] as const))('%s', (_k, p) => {
    const legacy = p.pollinatorRisk ?? 'unknown';
    const eff = effectivePollinatorRisk(p);
    const fromLabel = p.pollinator ? riskFromLabel(p.pollinator) : undefined;

    expect(RANK[eff]).toBeGreaterThanOrEqual(RANK[legacy]);
    if (fromLabel !== undefined) expect(RANK[eff]).toBeGreaterThanOrEqual(RANK[fromLabel]);
    expect([legacy, fromLabel]).toContain(eff);
    if (risky(legacy)) expect(isRiskyForBloom(p)).toBe(true);
    if (fromLabel !== undefined && risky(fromLabel)) expect(isRiskyForBloom(p)).toBe(true);
    if (!p.pollinator) expect(eff).toBe(legacy);
  });

  it('an unknown label is never safer than the legacy value', () => {
    for (const pollinatorRisk of LEGACY) {
      for (const bloomRestriction of RESTRICTIONS) {
        const without = isRiskyForBloom({ pluginId: 'p', pollinatorRisk });
        const withUnknown = isRiskyForBloom({
          pluginId: 'p',
          pollinatorRisk,
          pollinator: { beeToxicity: 'unknown', bloomRestriction }
        });
        if (without) expect(withUnknown).toBe(true);
      }
    }
  });

  it('a nontoxic label never clears a risky legacy hint', () => {
    for (const pollinatorRisk of ['moderate', 'high', 'unknown', undefined] as const) {
      expect(
        isRiskyForBloom({
          pluginId: 'p',
          pollinatorRisk,
          pollinator: { beeToxicity: 'relatively-nontoxic', bloomRestriction: 'none' }
        })
      ).toBe(true);
    }
  });

  it('a toxic label gates a product whose legacy hint said low or none', () => {
    for (const pollinatorRisk of ['none', 'low'] as const) {
      expect(isRiskyForBloom({ pluginId: 'p', pollinatorRisk })).toBe(false);
      for (const beeToxicity of ['toxic', 'highly-toxic'] as const) {
        expect(
          isRiskyForBloom({
            pluginId: 'p',
            pollinatorRisk,
            pollinator: { beeToxicity, bloomRestriction: 'none' }
          })
        ).toBe(true);
      }
    }
  });
});

describe('checkPollinatorBloom reads the label block', () => {
  it('blocks a low-hint product whose label is highly toxic, in bloom', () => {
    const v = checkPollinatorBloom(
      [
        {
          pluginId: 'x',
          pollinatorRisk: 'low',
          pollinator: { beeToxicity: 'highly-toxic', bloomRestriction: 'dusk-to-dawn-only' }
        }
      ],
      [BLOOMING],
      NOW
    );
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe('POLLINATOR_BLOOM_BLOCK');
    expect(v[0].detail).toMatchObject({ riskyProducts: ['x'] });
  });

  it('still passes out of bloom', () => {
    expect(
      checkPollinatorBloom(
        [{ pluginId: 'x', pollinator: { beeToxicity: 'highly-toxic', bloomRestriction: 'none' } }],
        [NOT_BLOOMING],
        NOW
      )
    ).toEqual([]);
  });

  const arbRisk = fc.constantFrom(...LEGACY);
  const arbLabel = fc.constantFrom(...LABELS);
  const arbProduct = fc.record({
    pluginId: fc.string({ minLength: 1, maxLength: 6 }),
    pollinatorRisk: arbRisk,
    pollinator: arbLabel
  });
  const arbCrop = fc.record({
    cropPluginId: fc.constantFrom('a', 'b', 'c'),
    plantedAt: fc.integer({ min: NOW - 200 * DAY, max: NOW }),
    bloomWindow: fc.option(
      fc.record({
        continuous: fc.option(fc.boolean(), { nil: undefined }),
        daysFromPlantingMin: fc.option(fc.integer({ min: 0, max: 120 }), { nil: undefined }),
        beeAttractive: fc.option(fc.boolean(), { nil: undefined })
      }),
      { nil: undefined }
    )
  });

  it('label data only adds blocks: the legacy-only verdict is a subset', () => {
    fc.assert(
      fc.property(
        fc.array(arbProduct, { minLength: 1, maxLength: 4 }),
        fc.array(arbCrop, { maxLength: 4 }),
        (products, crops) => {
          const withLabel = checkPollinatorBloom(products, crops, NOW);
          const legacyOnly = checkPollinatorBloom(
            products.map(({ pluginId, pollinatorRisk }) => ({ pluginId, pollinatorRisk })),
            crops,
            NOW
          );
          if (legacyOnly.length > 0) {
            expect(withLabel).toHaveLength(1);
            const got = (withLabel[0].detail as { riskyProducts: string[] }).riskyProducts;
            const was = (legacyOnly[0].detail as { riskyProducts: string[] }).riskyProducts;
            for (const id of was) expect(got).toContain(id);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it('adding a product never clears a block', () => {
    fc.assert(
      fc.property(
        fc.array(arbProduct, { minLength: 1, maxLength: 4 }),
        arbProduct,
        fc.array(arbCrop, { maxLength: 4 }),
        (products, extra, crops) => {
          if (checkPollinatorBloom(products, crops, NOW).length > 0) {
            expect(checkPollinatorBloom([...products, extra], crops, NOW)).toHaveLength(1);
          }
        }
      ),
      { numRuns: 300 }
    );
  });
});

describe('shipped fungicide plugins keep their verdicts', () => {
  const dir = path.resolve(__dirname, '../../../../../plugins/fungicides');
  const plugins = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => fungicidePluginSchema.parse(JSON.parse(readFileSync(path.join(dir, f), 'utf8'))));

  it('the schema keeps the label block', () => {
    expect(plugins.filter((p) => p.pollinator).length).toBeGreaterThan(60);
  });

  it.each(plugins.map((p) => [p.pluginId, p] as const))('%s', (_id, p) => {
    const product: SprayedProduct = {
      pluginId: p.pluginId,
      pollinatorRisk: p.pollinatorRisk ?? 'unknown',
      pollinator: p.pollinator
    };
    const legacyOnly: SprayedProduct = {
      pluginId: p.pluginId,
      pollinatorRisk: p.pollinatorRisk ?? 'unknown'
    };
    expect(isRiskyForBloom(product)).toBe(isRiskyForBloom(legacyOnly));
    expect(checkPollinatorBloom([product], [BLOOMING], NOW)).toEqual(
      checkPollinatorBloom([legacyOnly], [BLOOMING], NOW)
    );
  });
});
