import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_AI_DAILY_QUOTA, type AiEndpointName } from '$lib/schedule/constants';
import {
  AI_BUDGET_EXAMPLES,
  AI_PLAN_RESERVE_USD,
  AI_RESERVE_USD,
  TYPICAL_PLAN_USD,
  fullPlansFor,
  PAST_DUE_GRACE_DAYS,
  PLANS,
  PLAN_IDS,
  STARTER_BOOST_DAYS,
  effectiveDailyQuota,
  effectiveMonthlyCap,
  nextPlanUp,
  planForPriceId,
  priceIdFor,
  resolvePlanFrom,
  type PlanResolutionInput,
  type PriceIds
} from './plans';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 26, 12);
const OLD_OWNER = NOW - 90 * DAY;

function input(over: Partial<PlanResolutionInput> = {}): PlanResolutionInput {
  return {
    planOverride: null,
    subscription: null,
    ownerCreatedAt: OLD_OWNER,
    boostEligible: false,
    now: NOW,
    ...over
  };
}

const ENDPOINTS = Object.keys(DEFAULT_AI_DAILY_QUOTA) as AiEndpointName[];

describe('plan definitions', () => {
  it('match the go-live tier decision', () => {
    expect(PLANS.free).toMatchObject({
      monthlyPriceUsd: 0,
      aiMonthlyUsd: 0.5,
      helperSeats: 2,
      webSearchAi: false
    });
    expect(PLANS.grower).toMatchObject({
      monthlyPriceUsd: 10,
      annualPriceUsd: 96,
      aiMonthlyUsd: 4,
      helperSeats: 5,
      webSearchAi: true
    });
    expect(PLANS.farm).toMatchObject({
      monthlyPriceUsd: 20,
      annualPriceUsd: 192,
      aiMonthlyUsd: 10,
      helperSeats: 15,
      prioritySupport: true
    });
  });

  it.each([
    ['suggest', 5, 20, 40],
    ['succession', 5, 20, 40],
    ['planting-window', 10, 40, 40],
    ['garden-fill', 3, 10, 20],
    ['photo-help', 3, 10, 20],
    ['inputs', 2, 10, 20],
    ['shortNames', 2, 5, 10],
    ['scan-barcode', 10, 40, 60],
    ['scan-label', 3, 20, 40],
    ['scan-url', 1, 10, 20],
    ['plugin-scan', 1, 10, 20],
    ['allocate', 1, 5, 10],
    ['groups', 1, 5, 10],
    ['optimize', 0, 2, 5],
    ['plugin-search', 1, 10, 15],
    ['rationale', 0, 10, 20],
    ['plugin-batch-scan', 0, 1, 3]
  ] as const)('%s daily caps are %i / %i / %i', (endpoint, free, grower, farm) => {
    expect(PLANS.free.dailyQuota[endpoint]).toBe(free);
    expect(PLANS.grower.dailyQuota[endpoint]).toBe(grower);
    expect(PLANS.farm.dailyQuota[endpoint]).toBe(farm);
  });

  it('covers every AI endpoint on every plan with a reserve', () => {
    for (const plan of PLAN_IDS) {
      expect(Object.keys(PLANS[plan].dailyQuota).sort()).toEqual([...ENDPOINTS].sort());
    }
    for (const e of ENDPOINTS) expect(AI_RESERVE_USD[e]).toBeGreaterThan(0);
  });

  it('never reserves more for one call than a plan that offers the feature can spend', () => {
    for (const plan of PLAN_IDS) {
      for (const e of ENDPOINTS) {
        if (PLANS[plan].dailyQuota[e] > 0) {
          expect(AI_RESERVE_USD[e]).toBeLessThanOrEqual(PLANS[plan].aiMonthlyUsd);
        }
      }
    }
  });

  it('keeps receipt scans and stock web refresh off Free', () => {
    expect(PLANS.free.dailyQuota['plugin-batch-scan']).toBe(0);
    expect(PLANS.free.dailyQuota.rationale).toBe(0);
  });

  it('suggests the next plan up', () => {
    expect(nextPlanUp('free')).toBe('grower');
    expect(nextPlanUp('grower')).toBe('farm');
    expect(nextPlanUp('farm')).toBeNull();
  });
});

describe('resolvePlanFrom', () => {
  it('is Free with the base budget when there is no subscription', () => {
    expect(resolvePlanFrom(input())).toMatchObject({
      plan: 'free',
      source: 'free',
      aiMonthlyUsd: 0.5,
      helperSeats: 2,
      starterBoost: false
    });
  });

  it.each(['active', 'trial'])('%s paid subscriptions grant the plan', (status) => {
    const r = resolvePlanFrom(
      input({ subscription: { plan: 'grower', status, pastDueSince: null } })
    );
    expect(r).toMatchObject({ plan: 'grower', source: 'stripe', aiMonthlyUsd: 4, helperSeats: 5 });
  });

  it.each(['canceled', 'incomplete', 'suspended'])('%s never grants a paid plan', (status) => {
    const r = resolvePlanFrom(
      input({ subscription: { plan: 'farm', status, pastDueSince: null } })
    );
    expect(r.plan).toBe('free');
  });

  it('an active row on the free plan code stays Free', () => {
    expect(
      resolvePlanFrom(
        input({ subscription: { plan: 'free', status: 'active', pastDueSince: null } })
      ).plan
    ).toBe('free');
  });

  it('an unknown legacy plan code resolves to Free', () => {
    expect(
      resolvePlanFrom(
        input({ subscription: { plan: 'solo', status: 'active', pastDueSince: null } })
      ).plan
    ).toBe('free');
  });

  describe('past_due grace window', () => {
    const since = NOW - 2 * DAY;
    const pastDue = (now: number) =>
      resolvePlanFrom(
        input({ now, subscription: { plan: 'farm', status: 'past_due', pastDueSince: since } })
      );

    it('keeps the paid plan inside the window', () => {
      expect(pastDue(NOW)).toMatchObject({
        plan: 'farm',
        source: 'grace',
        graceEndsAt: since + PAST_DUE_GRACE_DAYS * DAY
      });
    });

    it('keeps it one millisecond before the window closes', () => {
      expect(pastDue(since + PAST_DUE_GRACE_DAYS * DAY - 1).plan).toBe('farm');
    });

    it('drops to Free exactly when the window closes', () => {
      expect(pastDue(since + PAST_DUE_GRACE_DAYS * DAY).plan).toBe('free');
    });

    it('drops to Free when the failure time is unknown', () => {
      const r = resolvePlanFrom(
        input({ subscription: { plan: 'farm', status: 'past_due', pastDueSince: null } })
      );
      expect(r.plan).toBe('free');
    });
  });

  it('a superadmin override wins over Stripe in both directions', () => {
    expect(
      resolvePlanFrom(
        input({
          planOverride: 'farm',
          subscription: { plan: 'free', status: 'active', pastDueSince: null }
        })
      )
    ).toMatchObject({ plan: 'farm', source: 'override' });
    expect(
      resolvePlanFrom(
        input({
          planOverride: 'free',
          subscription: { plan: 'grower', status: 'active', pastDueSince: null }
        })
      )
    ).toMatchObject({ plan: 'free', source: 'override' });
  });

  describe('starter boost', () => {
    const young = NOW - 3 * DAY;

    it('lifts a young Free farm with a verified identity to $1.00', () => {
      expect(resolvePlanFrom(input({ ownerCreatedAt: young, boostEligible: true }))).toMatchObject({
        plan: 'free',
        aiMonthlyUsd: 1,
        starterBoost: true,
        boostEndsAt: young + STARTER_BOOST_DAYS * DAY
      });
    });

    it('ends exactly 30 days after the owner row is created', () => {
      const r = resolvePlanFrom(
        input({ ownerCreatedAt: NOW - STARTER_BOOST_DAYS * DAY, boostEligible: true })
      );
      expect(r).toMatchObject({ aiMonthlyUsd: 0.5, starterBoost: false });
    });

    it('needs eligibility (a verified identity that has not used it)', () => {
      expect(resolvePlanFrom(input({ ownerCreatedAt: young })).aiMonthlyUsd).toBe(0.5);
    });

    it('never changes a paid plan budget', () => {
      const r = resolvePlanFrom(
        input({
          ownerCreatedAt: young,
          boostEligible: true,
          subscription: { plan: 'grower', status: 'active', pastDueSince: null }
        })
      );
      expect(r).toMatchObject({ plan: 'grower', aiMonthlyUsd: 4, starterBoost: false });
    });
  });
});

describe('owner limits only ever lower the plan', () => {
  it('monthly cap', () => {
    expect(effectiveMonthlyCap(4, null)).toBe(4);
    expect(effectiveMonthlyCap(4, 0)).toBe(0);
    expect(effectiveMonthlyCap(4, 1.5)).toBe(1.5);
    expect(effectiveMonthlyCap(4, 50)).toBe(4);
    expect(effectiveMonthlyCap(4, -1)).toBe(4);
    expect(effectiveMonthlyCap(4, Number.NaN)).toBe(4);
  });

  it('property: the effective cap is never above the plan budget or below zero', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PLAN_IDS),
        fc.option(fc.double({ noNaN: false, min: -1e6, max: 1e6 }), { nil: null }),
        (plan, setting) => {
          const cap = effectiveMonthlyCap(PLANS[plan].aiMonthlyUsd, setting);
          return cap <= PLANS[plan].aiMonthlyUsd && cap >= 0;
        }
      )
    );
  });

  it('daily quotas take the lower of plan and owner', () => {
    const q = effectiveDailyQuota(PLANS.grower.dailyQuota, {
      suggest: 3,
      allocate: 500,
      optimize: -4
    });
    expect(q.suggest).toBe(3);
    expect(q.allocate).toBe(PLANS.grower.dailyQuota.allocate);
    expect(q.optimize).toBe(PLANS.grower.dailyQuota.optimize);
  });

  it('property: no owner override raises any daily quota', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PLAN_IDS),
        fc.dictionary(fc.constantFrom(...ENDPOINTS), fc.integer({ min: -10, max: 10_000 })),
        (plan, overrides) => {
          const q = effectiveDailyQuota(PLANS[plan].dailyQuota, overrides);
          return ENDPOINTS.every((e) => q[e] <= PLANS[plan].dailyQuota[e] && q[e] >= 0);
        }
      )
    );
  });
});

describe('Stripe price mapping', () => {
  const prices: PriceIds = {
    growerMonthly: 'p_gm',
    growerAnnual: 'p_ga',
    farmMonthly: 'p_fm',
    farmAnnual: 'p_fa'
  };

  it('round-trips every plan and interval', () => {
    for (const plan of ['grower', 'farm'] as const) {
      for (const interval of ['month', 'year'] as const) {
        const id = priceIdFor(prices, plan, interval);
        expect(planForPriceId(prices, id)).toEqual({ plan, interval });
      }
    }
  });

  it('returns null for unknown or missing prices', () => {
    expect(planForPriceId(prices, 'p_other')).toBeNull();
    expect(planForPriceId(prices, null)).toBeNull();
    expect(priceIdFor({ ...prices, farmAnnual: null }, 'farm', 'year')).toBeNull();
  });
});

describe('plan copy matches what the guard allows', () => {
  it('a full plan starts only while spend plus the planning reserve fits', () => {
    expect(AI_PLAN_RESERVE_USD).toBe(AI_RESERVE_USD.allocate);
    const budget = PLANS.free.aiMonthlyUsd;
    const n = fullPlansFor(budget);
    expect((n - 1) * TYPICAL_PLAN_USD + AI_RESERVE_USD.allocate).toBeLessThanOrEqual(budget);
    expect(n * TYPICAL_PLAN_USD + AI_RESERVE_USD.allocate).toBeGreaterThan(budget);
  });

  it('the Free card promises 2 full plans, not 3', () => {
    expect(fullPlansFor(PLANS.free.aiMonthlyUsd)).toBe(2);
    expect(AI_BUDGET_EXAMPLES.free).toContain('About 2 full AI plans');
    expect(AI_BUDGET_EXAMPLES.free).not.toContain('About 3');
  });

  it('the Grower card never promises more plans than fit', () => {
    const claimed = Number(AI_BUDGET_EXAMPLES.grower.match(/About (\d+)/)?.[1]);
    expect(claimed).toBeLessThanOrEqual(fullPlansFor(PLANS.grower.aiMonthlyUsd));
  });
});
