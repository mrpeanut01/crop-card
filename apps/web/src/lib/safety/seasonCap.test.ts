import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { convert, type StockUnit } from '$lib/stock/units';
import { evaluateSpray } from './evaluate';
import {
  capsForCrops,
  checkSeasonCaps,
  convertRateAmount,
  evaluateSeasonCaps,
  localYearBounds,
  seasonCapReadSpan,
  type SeasonCapApplication,
  type SeasonCapContext,
  type SeasonCapPeriod,
  type SeasonCapRow,
  type SeasonCapVerdict
} from './seasonCap';
import type { SprayContext } from './types';

const TZ = 'America/New_York';
const DAY = 24 * 60 * 60 * 1000;
const JUNE_10 = Date.UTC(2026, 5, 10, 16);
const BANVEL_CORN: SeasonCapRow = {
  cropPluginIds: ['corn-feed-dent-pioneer', 'popcorn-strawberry'],
  amount: 1.5,
  unit: 'pt',
  period: 'crop-year'
};

function app(
  occurredAt: number,
  rate: { amount: number; unit: string } | null = { amount: 0.5, unit: 'pt' },
  pluginId = 'banvel',
  id = `a${occurredAt}`
): SeasonCapApplication {
  return { id, pluginId, occurredAt, rate };
}

function ctx(over: Partial<SeasonCapContext> = {}): SeasonCapContext {
  return {
    occurredAt: JUNE_10,
    cropPluginIds: ['corn-feed-dent-pioneer'],
    products: [
      {
        pluginId: 'banvel',
        displayName: 'Banvel',
        rate: { amount: 0.5, unit: 'pt' },
        caps: [BANVEL_CORN]
      }
    ],
    others: [],
    timeZone: TZ,
    ...over
  };
}

function one(c: SeasonCapContext): SeasonCapVerdict {
  const v = evaluateSeasonCaps(c);
  expect(v).toHaveLength(1);
  return v[0];
}

describe('convertRateAmount', () => {
  it('converts label volumes and weights and refuses volume against weight', () => {
    expect(convertRateAmount(1.5, 'pt', 'fl-oz')).toBe(24);
    expect(convertRateAmount(24, 'fl-oz', 'pt')).toBe(1.5);
    expect(convertRateAmount(1, 'qt', 'pt')).toBe(2);
    expect(convertRateAmount(1, 'gal', 'qt')).toBe(4);
    expect(convertRateAmount(1, 'lb', 'oz')).toBe(16);
    expect(convertRateAmount(1, 'fl-oz', 'oz')).toBeNull();
    expect(convertRateAmount(1, 'lb', 'pt')).toBeNull();
    expect(convertRateAmount(1, 'pt', 'acre')).toBeNull();
    expect(convertRateAmount(Number.NaN, 'pt', 'pt')).toBeNull();
  });

  it('agrees with the stock unit conversion for every label rate unit pair', () => {
    const units: StockUnit[] = ['fl-oz', 'pt', 'qt', 'gal', 'oz', 'lb'];
    for (const a of units) {
      for (const b of units) {
        const ours = convertRateAmount(3, a, b);
        const stock = convert(3, a, b);
        if (stock === null) expect(ours).toBeNull();
        else expect(ours).toBeCloseTo(stock, 6);
      }
    }
  });
});

describe('localYearBounds', () => {
  it('starts the year at farm-local midnight, not UTC', () => {
    const [start, end] = localYearBounds(JUNE_10, TZ);
    expect(start).toBe(Date.UTC(2026, 0, 1, 5));
    expect(end).toBe(Date.UTC(2027, 0, 1, 5));
    const lateNewYearsEve = Date.UTC(2027, 0, 1, 3);
    expect(localYearBounds(lateNewYearsEve, TZ)[0]).toBe(Date.UTC(2026, 0, 1, 5));
  });

  it('handles a leap year and another zone', () => {
    const [start, end] = localYearBounds(Date.UTC(2028, 1, 29, 12), 'America/Los_Angeles');
    expect(start).toBe(Date.UTC(2028, 0, 1, 8));
    expect(end).toBe(Date.UTC(2029, 0, 1, 8));
  });
});

describe('evaluateSeasonCaps (#820)', () => {
  it('a third ½ pt Banvel pass on corn reaches the 1 ½ pt cap and a fourth goes over', () => {
    const two = [app(Date.UTC(2026, 4, 1)), app(Date.UTC(2026, 4, 20))];
    const third = one(ctx({ others: two }));
    expect(third).toMatchObject({
      status: 'within',
      knownTotal: 1.5,
      othersKnown: 1,
      thisPass: 0.5
    });
    const fourth = one(ctx({ others: [...two, app(Date.UTC(2026, 5, 1))] }));
    expect(fourth).toMatchObject({ status: 'over', knownTotal: 2 });
  });

  it('counts other units after converting them to the cap unit', () => {
    const v = one(ctx({ others: [app(Date.UTC(2026, 4, 1), { amount: 16, unit: 'fl-oz' })] }));
    expect(v).toMatchObject({ status: 'within', othersKnown: 1, knownTotal: 1.5 });
    const over = one(
      ctx({
        others: [app(Date.UTC(2026, 4, 1), { amount: 17, unit: 'fl-oz' })]
      })
    );
    expect(over.status).toBe('over');
  });

  it('a calendar-year cap does not count last year, a 365-day cap does', () => {
    const lastYear = [app(Date.UTC(2025, 6, 1), { amount: 1.5, unit: 'pt' })];
    expect(one(ctx({ others: lastYear })).status).toBe('within');
    const rolling = ctx({
      others: lastYear,
      products: [{ ...ctx().products[0], caps: [{ ...BANVEL_CORN, period: '365-days' }] }]
    });
    expect(one(rolling).status).toBe('over');
    const longAgo = ctx({
      others: [app(JUNE_10 - 365 * DAY, { amount: 1.5, unit: 'pt' })],
      products: rolling.products
    });
    expect(one(longAgo).status).toBe('within');
  });

  it('a backdated pass counts applications saved later in the same window', () => {
    const later = [app(Date.UTC(2026, 7, 1), { amount: 1.5, unit: 'pt' })];
    expect(one(ctx({ others: later })).status).toBe('over');
  });

  it('an earlier record with no rate is never read as under the cap', () => {
    const v = one(ctx({ others: [app(Date.UTC(2026, 4, 1), null)] }));
    expect(v.status).toBe('unknown');
    expect(v.unknown).toEqual(['earlier-rate']);
    expect(v.unknownIds).toEqual([`a${Date.UTC(2026, 4, 1)}`]);
    expect(checkSeasonCaps(ctx({ others: [app(Date.UTC(2026, 4, 1), null)] }))).toEqual([]);
  });

  it('a known total over the cap stops even when other amounts are unknown', () => {
    const v = one(
      ctx({
        others: [
          app(Date.UTC(2026, 3, 1), null),
          app(Date.UTC(2026, 4, 1), { amount: 1.5, unit: 'pt' })
        ]
      })
    );
    expect(v.status).toBe('over');
  });

  it("this pass's own unknown rate or a unit that cannot convert is unknown", () => {
    const noRate = one(ctx({ products: [{ ...ctx().products[0], rate: null }] }));
    expect(noRate).toMatchObject({
      status: 'unknown',
      unknown: ['this-pass-rate'],
      thisPass: null
    });
    const weight = one(ctx({ others: [app(Date.UTC(2026, 4, 1), { amount: 1, unit: 'lb' })] }));
    expect(weight).toMatchObject({ status: 'unknown', unknown: ['unit'] });
  });

  it('ignores other products and crops the cap does not name', () => {
    expect(
      one(ctx({ others: [app(Date.UTC(2026, 4, 1), { amount: 9, unit: 'pt' }, 'other')] })).status
    ).toBe('within');
    expect(evaluateSeasonCaps(ctx({ cropPluginIds: ['wheat-soft-red-winter'] }))).toEqual([]);
  });

  it('judges every cap row for co-planted crops, once per distinct cap', () => {
    const sweet: SeasonCapRow = {
      cropPluginIds: ['sweet'],
      amount: 3,
      unit: 'fl-oz',
      period: 'growing-season'
    };
    const field: SeasonCapRow = {
      cropPluginIds: ['field'],
      amount: 6,
      unit: 'fl-oz',
      period: 'growing-season'
    };
    const c = ctx({
      cropPluginIds: ['field', 'sweet'],
      products: [
        {
          pluginId: 'laudis',
          displayName: 'Laudis',
          rate: { amount: 3, unit: 'fl-oz' },
          caps: [field, sweet]
        }
      ],
      others: [app(Date.UTC(2026, 4, 1), { amount: 3, unit: 'fl-oz' }, 'laudis')]
    });
    const verdicts = evaluateSeasonCaps(c);
    expect(verdicts.map((v) => [v.cap.amount, v.status])).toEqual([
      [6, 'within'],
      [3, 'over']
    ]);
    expect(capsForCrops([field, sweet, field], ['field'])).toEqual([field, field]);
  });

  it('turns an over verdict into a SEASON_CAP_EXCEEDED stop in evaluateSpray', () => {
    const spray: SprayContext = {
      occurredAt: JUNE_10,
      products: [
        {
          pluginId: 'banvel',
          displayName: 'Banvel',
          activeIngredients: [{ name: 'dicamba', chemistryClass: 'synthetic-auxin' }],
          labelClaims: { safeForCropPluginIds: ['corn-feed-dent-pioneer'] }
        }
      ],
      crop: { cropPluginId: 'corn-feed-dent-pioneer', cropFamily: 'corn', heightInches: 6 },
      sprayer: { id: 's1' },
      conditions: { windMph: 5, tempF: 70, rainForecastMmNext24h: 0 }
    };
    expect(evaluateSpray(spray).ok).toBe(true);
    const over = evaluateSpray(spray, {
      seasonCaps: ctx({ others: [app(Date.UTC(2026, 4, 1), { amount: 1.5, unit: 'pt' })] })
    });
    expect(over.ok).toBe(false);
    expect(over.violations.map((v) => v.code)).toEqual(['SEASON_CAP_EXCEEDED']);
    expect(over.violations[0].message).toBe(
      'Banvel: 2 pt/acre on this block would exceed the label limit of 1.5 pt/acre per crop year.'
    );
    const unknown = evaluateSpray(spray, {
      seasonCaps: ctx({ others: [app(Date.UTC(2026, 4, 1), null)] })
    });
    expect(unknown.ok).toBe(true);
  });

  it('reads one span wide enough for every period', () => {
    expect(seasonCapReadSpan(JUNE_10, [], TZ)).toBeNull();
    const [from, to] = seasonCapReadSpan(JUNE_10, ['crop-year', '365-days'], TZ)!;
    expect(from).toBe(JUNE_10 - 365 * DAY + 1);
    expect(to).toBe(JUNE_10 + 365 * DAY);
    expect(seasonCapReadSpan(JUNE_10, ['year'], TZ)).toEqual(localYearBounds(JUNE_10, TZ));
  });
});

const RANK = { within: 0, unknown: 1, over: 2 } as const;
const PERIODS: SeasonCapPeriod[] = ['crop-year', 'season', 'growing-season', 'year', '365-days'];
const YEAR_2026 = localYearBounds(JUNE_10, TZ);

const rateArb = fc.option(
  fc.record({
    amount: fc.integer({ min: 0, max: 40 }).map((n) => n / 4),
    unit: fc.constantFrom('pt', 'fl-oz', 'qt', 'lb')
  }),
  { nil: null, freq: 5 }
);
const appArb = fc.record({
  id: fc.uuid(),
  pluginId: fc.constantFrom('banvel', 'banvel', 'other'),
  occurredAt: fc.integer({ min: JUNE_10 - 500 * DAY, max: JUNE_10 + 500 * DAY }),
  rate: rateArb
});
const ctxArb = fc.record({
  period: fc.constantFrom(...PERIODS),
  capAmount: fc.integer({ min: 1, max: 40 }).map((n) => n / 4),
  capUnit: fc.constantFrom('pt', 'fl-oz'),
  thisRate: rateArb,
  others: fc.array(appArb, { maxLength: 8 })
});

interface CapCase {
  period: SeasonCapPeriod;
  capAmount: number;
  capUnit: string;
  thisRate: { amount: number; unit: string } | null;
  others: SeasonCapApplication[];
}

function build(c: CapCase): SeasonCapContext {
  return ctx({
    products: [
      {
        pluginId: 'banvel',
        displayName: 'Banvel',
        rate: c.thisRate,
        caps: [{ ...BANVEL_CORN, amount: c.capAmount, unit: c.capUnit, period: c.period }]
      }
    ],
    others: c.others
  });
}

describe('season cap properties', () => {
  it('another application never makes a verdict less strict, and the known total never falls', () => {
    fc.assert(
      fc.property(ctxArb, appArb, (c, extra) => {
        const before = one(build(c));
        const after = one(build({ ...c, others: [...c.others, extra] }));
        expect(RANK[after.status]).toBeGreaterThanOrEqual(RANK[before.status]);
        expect(after.knownTotal).toBeGreaterThanOrEqual(before.knownTotal - 1e-9);
      }),
      { numRuns: 400 }
    );
  });

  it('a lower cap never makes a verdict less strict', () => {
    fc.assert(
      fc.property(ctxArb, fc.integer({ min: 0, max: 39 }), (c, cut) => {
        const lower = Math.max(0.25, c.capAmount - cut / 4);
        const a = one(build(c));
        const b = one(build({ ...c, capAmount: lower }));
        expect(RANK[b.status]).toBeGreaterThanOrEqual(RANK[a.status]);
      }),
      { numRuns: 300 }
    );
  });

  it('is never "within" while an application in reach has an amount not known', () => {
    fc.assert(
      fc.property(ctxArb, (c) => {
        const v = one(build(c));
        const [from, to] =
          c.period === '365-days' ? [JUNE_10 - 365 * DAY + 1, JUNE_10 + 365 * DAY] : YEAR_2026;
        const anyUnknown =
          c.thisRate === null ||
          convertRateAmount(c.thisRate.amount, c.thisRate.unit, c.capUnit) === null ||
          c.others.some(
            (o) =>
              o.pluginId === 'banvel' &&
              o.occurredAt >= from &&
              o.occurredAt < to &&
              (o.rate === null || convertRateAmount(o.rate.amount, o.rate.unit, c.capUnit) === null)
          );
        if (anyUnknown) expect(v.status).not.toBe('within');
        if (v.status === 'over') expect(checkSeasonCaps(build(c))).toHaveLength(1);
        else expect(checkSeasonCaps(build(c))).toEqual([]);
      }),
      { numRuns: 400 }
    );
  });

  it('does not depend on the order the applications are listed in', () => {
    fc.assert(
      fc.property(ctxArb, fc.integer(), (c, seed) => {
        const shuffled = [...c.others].sort(
          (a, b) => ((a.occurredAt ^ seed) & 0xff) - ((b.occurredAt ^ seed) & 0xff)
        );
        const a = one(build(c));
        const b = one(build({ ...c, others: shuffled }));
        expect(b.status).toBe(a.status);
        expect(b.knownTotal).toBeCloseTo(a.knownTotal, 9);
      }),
      { numRuns: 300 }
    );
  });

  it('a calendar-year verdict is the plain sum inside the farm-local year', () => {
    fc.assert(
      fc.property(
        ctxArb.filter((c) => c.period !== '365-days'),
        (c) => {
          const v = one(build(c));
          let sum = 0;
          let unknown = false;
          for (const o of c.others) {
            if (
              o.pluginId !== 'banvel' ||
              o.occurredAt < YEAR_2026[0] ||
              o.occurredAt >= YEAR_2026[1]
            )
              continue;
            const a = o.rate ? convertRateAmount(o.rate.amount, o.rate.unit, c.capUnit) : null;
            if (a === null) unknown = true;
            else sum += a;
          }
          const mine = c.thisRate
            ? convertRateAmount(c.thisRate.amount, c.thisRate.unit, c.capUnit)
            : null;
          if (mine === null) unknown = true;
          const total = sum + (mine ?? 0);
          expect(v.knownTotal).toBeCloseTo(total, 9);
          expect(v.status).toBe(
            total > c.capAmount + 1e-6 ? 'over' : unknown ? 'unknown' : 'within'
          );
        }
      ),
      { numRuns: 400 }
    );
  });

  it('a 365-day verdict is the fullest 365-day window holding this pass (brute force)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            pluginId: fc.constant('banvel'),
            occurredAt: fc.integer({ min: -400, max: 400 }).map((d) => JUNE_10 + d * DAY + 1000),
            rate: fc.integer({ min: 0, max: 8 }).map((n) => ({ amount: n / 4, unit: 'pt' }))
          }),
          { maxLength: 7 }
        ),
        fc.integer({ min: 1, max: 12 }).map((n) => n / 4),
        (others, capAmount) => {
          const v = one(
            ctx({
              others,
              products: [
                {
                  ...ctx().products[0],
                  caps: [{ ...BANVEL_CORN, amount: capAmount, period: '365-days' }]
                }
              ]
            })
          );
          let most = 0;
          for (let s = JUNE_10 - 365 * DAY + 1; s <= JUNE_10; s += DAY / 2) {
            const starts = [s, ...others.map((o) => o.occurredAt)].filter(
              (x) => x > JUNE_10 - 365 * DAY && x <= JUNE_10
            );
            for (const st of starts) {
              const sum = others
                .filter((o) => o.occurredAt >= st && o.occurredAt < st + 365 * DAY)
                .reduce((n, o) => n + o.rate.amount, 0);
              most = Math.max(most, sum);
            }
          }
          expect(v.othersKnown).toBeCloseTo(most, 9);
          expect(v.status).toBe(most + 0.5 > capAmount + 1e-6 ? 'over' : 'within');
        }
      ),
      { numRuns: 150 }
    );
  });
});
