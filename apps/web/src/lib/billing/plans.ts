import type { AiEndpointName } from '$lib/schedule/constants';

export const PLAN_IDS = ['free', 'grower', 'farm'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export type PaidPlanId = Exclude<PlanId, 'free'>;

export type DailyQuota = Record<AiEndpointName, number>;

export interface PlanDefinition {
  id: PlanId;
  name: string;
  monthlyPriceUsd: number;
  annualPriceUsd: number;
  aiMonthlyUsd: number;
  helperSeats: number;
  webSearchAi: boolean;
  prioritySupport: boolean;
  dailyQuota: DailyQuota;
}

const FREE_QUOTA: DailyQuota = {
  suggest: 5,
  succession: 5,
  'planting-window': 10,
  'garden-fill': 3,
  'photo-help': 3,
  inputs: 2,
  shortNames: 2,
  'scan-barcode': 10,
  'scan-label': 3,
  'scan-url': 1,
  'plugin-scan': 1,
  allocate: 1,
  groups: 1,
  optimize: 0,
  'plugin-search': 1,
  rationale: 0,
  'plugin-batch-scan': 0
};

const GROWER_QUOTA: DailyQuota = {
  suggest: 20,
  succession: 20,
  'planting-window': 40,
  'garden-fill': 10,
  'photo-help': 10,
  inputs: 10,
  shortNames: 5,
  'scan-barcode': 40,
  'scan-label': 20,
  'scan-url': 10,
  'plugin-scan': 10,
  allocate: 5,
  groups: 5,
  optimize: 2,
  'plugin-search': 10,
  rationale: 10,
  'plugin-batch-scan': 1
};

const FARM_QUOTA: DailyQuota = {
  suggest: 40,
  succession: 40,
  'planting-window': 40,
  'garden-fill': 20,
  'photo-help': 20,
  inputs: 20,
  shortNames: 10,
  'scan-barcode': 60,
  'scan-label': 40,
  'scan-url': 20,
  'plugin-scan': 20,
  allocate: 10,
  groups: 10,
  optimize: 5,
  'plugin-search': 15,
  rationale: 20,
  'plugin-batch-scan': 3
};

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyPriceUsd: 0,
    annualPriceUsd: 0,
    aiMonthlyUsd: 0.5,
    helperSeats: 2,
    webSearchAi: false,
    prioritySupport: false,
    dailyQuota: FREE_QUOTA
  },
  grower: {
    id: 'grower',
    name: 'Grower',
    monthlyPriceUsd: 10,
    annualPriceUsd: 96,
    aiMonthlyUsd: 4,
    helperSeats: 5,
    webSearchAi: true,
    prioritySupport: false,
    dailyQuota: GROWER_QUOTA
  },
  farm: {
    id: 'farm',
    name: 'Farm',
    monthlyPriceUsd: 20,
    annualPriceUsd: 192,
    aiMonthlyUsd: 10,
    helperSeats: 15,
    webSearchAi: true,
    prioritySupport: true,
    dailyQuota: FARM_QUOTA
  }
};

export const STARTER_BOOST_USD = 1;
export const STARTER_BOOST_DAYS = 30;
export const PAST_DUE_GRACE_DAYS = 7;
export const MONEY_BACK_DAYS = 30;
export const DEFAULT_FREE_POOL_MONTHLY_USD = 50;

const DAY_MS = 86_400_000;

const SONNET_PLAN = 0.25;
const WEB_SEARCH = 0.25;
const VISION = 0.03;
const HAIKU = 0.02;

/** Worst-case cost of one call, checked against the budget before the call
 *  goes out so a single request can never push spend past the cap. */
export const AI_RESERVE_USD: Record<AiEndpointName, number> = {
  allocate: SONNET_PLAN,
  groups: SONNET_PLAN,
  optimize: SONNET_PLAN,
  'plugin-search': WEB_SEARCH,
  rationale: WEB_SEARCH,
  'plugin-batch-scan': 0.5,
  'scan-label': VISION,
  'plugin-scan': VISION,
  'photo-help': VISION,
  'scan-url': 0.05,
  inputs: 0.03,
  suggest: HAIKU,
  succession: HAIKU,
  shortNames: HAIKU,
  'planting-window': HAIKU,
  'garden-fill': HAIKU,
  'scan-barcode': HAIKU
};

/** Below this much left, no AI feature can start. */
export const AI_MIN_RESERVE_USD = Math.min(...Object.values(AI_RESERVE_USD));

/** Below this much left, a full AI plan cannot start but quick help can. */
export const AI_PLAN_RESERVE_USD = SONNET_PLAN;

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === 'string' && (PLAN_IDS as readonly string[]).includes(v);
}

export function isPaidPlan(v: unknown): v is PaidPlanId {
  return v === 'grower' || v === 'farm';
}

export function isBillingInterval(v: unknown): v is BillingInterval {
  return v === 'month' || v === 'year';
}

export function planRank(plan: PlanId): number {
  return PLAN_IDS.indexOf(plan);
}

/** The plan to suggest when a farm runs out of AI, or null on the top plan. */
export function nextPlanUp(plan: PlanId): PaidPlanId | null {
  if (plan === 'free') return 'grower';
  if (plan === 'grower') return 'farm';
  return null;
}

export type PlanSource = 'override' | 'stripe' | 'grace' | 'free';

export interface SubscriptionSnapshot {
  plan: string | null;
  status: string | null;
  pastDueSince: number | null;
}

export interface PlanResolutionInput {
  planOverride: string | null;
  subscription: SubscriptionSnapshot | null;
  ownerCreatedAt: number;
  boostEligible: boolean;
  now: number;
}

export interface ResolvedPlan {
  plan: PlanId;
  source: PlanSource;
  aiMonthlyUsd: number;
  helperSeats: number;
  dailyQuota: DailyQuota;
  starterBoost: boolean;
  boostEndsAt: number | null;
  graceEndsAt: number | null;
}

function paidPlanFromSubscription(
  sub: SubscriptionSnapshot | null,
  now: number
): { plan: PaidPlanId; grace: boolean; graceEndsAt: number | null } | null {
  if (!sub || !isPaidPlan(sub.plan)) return null;
  if (sub.status === 'active' || sub.status === 'trial') {
    return { plan: sub.plan, grace: false, graceEndsAt: null };
  }
  if (sub.status === 'past_due' && sub.pastDueSince != null) {
    const graceEndsAt = sub.pastDueSince + PAST_DUE_GRACE_DAYS * DAY_MS;
    if (now < graceEndsAt) return { plan: sub.plan, grace: true, graceEndsAt };
  }
  return null;
}

export function starterBoostWindowOpen(ownerCreatedAt: number, now: number): boolean {
  return now - ownerCreatedAt < STARTER_BOOST_DAYS * DAY_MS;
}

export function resolvePlanFrom(input: PlanResolutionInput): ResolvedPlan {
  const build = (
    plan: PlanId,
    source: PlanSource,
    extra: Partial<Pick<ResolvedPlan, 'starterBoost' | 'boostEndsAt' | 'graceEndsAt'>> = {}
  ): ResolvedPlan => {
    const def = PLANS[plan];
    const starterBoost = extra.starterBoost ?? false;
    return {
      plan,
      source,
      aiMonthlyUsd: starterBoost ? Math.max(def.aiMonthlyUsd, STARTER_BOOST_USD) : def.aiMonthlyUsd,
      helperSeats: def.helperSeats,
      dailyQuota: def.dailyQuota,
      starterBoost,
      boostEndsAt: extra.boostEndsAt ?? null,
      graceEndsAt: extra.graceEndsAt ?? null
    };
  };

  if (isPlanId(input.planOverride)) return build(input.planOverride, 'override');

  const paid = paidPlanFromSubscription(input.subscription, input.now);
  if (paid) {
    return build(paid.plan, paid.grace ? 'grace' : 'stripe', { graceEndsAt: paid.graceEndsAt });
  }

  if (input.boostEligible && starterBoostWindowOpen(input.ownerCreatedAt, input.now)) {
    return build('free', 'free', {
      starterBoost: true,
      boostEndsAt: input.ownerCreatedAt + STARTER_BOOST_DAYS * DAY_MS
    });
  }
  return build('free', 'free');
}

/** The owner may lower the budget but never raise it past the plan's. */
export function effectiveMonthlyCap(planBudget: number, ownerSetting: number | null): number {
  if (ownerSetting == null || !Number.isFinite(ownerSetting) || ownerSetting < 0) return planBudget;
  return Math.min(planBudget, ownerSetting);
}

export function effectiveDailyQuota(
  planQuota: DailyQuota,
  ownerOverrides: Partial<Record<AiEndpointName, number>>
): DailyQuota {
  const out = { ...planQuota };
  for (const key of Object.keys(out) as AiEndpointName[]) {
    const o = ownerOverrides[key];
    if (typeof o === 'number' && Number.isFinite(o) && o >= 0) out[key] = Math.min(out[key], o);
  }
  return out;
}

export interface AiUsageSnapshot {
  monthlyUsdSoFar: number;
  cap: number;
  planBudget: number;
  pctUsed: number;
  warnAt80: boolean;
  exhausted: boolean;
  /** Enough left for quick help but not for a full AI plan. */
  quickOnly: boolean;
  aiOff: boolean;
  plan: PlanId;
  planName: string;
  planSource: PlanSource;
  starterBoost: boolean;
  boostEndsAt: number | null;
  graceEndsAt: number | null;
  upgrade: PaidPlanId | null;
}

export interface PriceIds {
  growerMonthly: string | null;
  growerAnnual: string | null;
  farmMonthly: string | null;
  farmAnnual: string | null;
}

export function priceIdFor(prices: PriceIds, plan: PaidPlanId, interval: BillingInterval) {
  if (plan === 'grower') return interval === 'year' ? prices.growerAnnual : prices.growerMonthly;
  return interval === 'year' ? prices.farmAnnual : prices.farmMonthly;
}

export function planForPriceId(
  prices: PriceIds,
  priceId: string | null | undefined
): { plan: PaidPlanId; interval: BillingInterval } | null {
  if (!priceId) return null;
  if (priceId === prices.growerMonthly) return { plan: 'grower', interval: 'month' };
  if (priceId === prices.growerAnnual) return { plan: 'grower', interval: 'year' };
  if (priceId === prices.farmMonthly) return { plan: 'farm', interval: 'month' };
  if (priceId === prices.farmAnnual) return { plan: 'farm', interval: 'year' };
  return null;
}

export function annualMonthlyEquivalent(plan: PlanId): number {
  return PLANS[plan].annualPriceUsd / 12;
}

export function formatUsd(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

export const FREE_FOREVER_FEATURES = [
  'Every record: spray, insecticide, fungicide, harvest, hay, fertility, scout, decon, calibration, winterization and season close-out',
  'The full safety kernel, the 48-hour record lock and the hash chain',
  'Inventory with manual and barcode entry',
  'Calendar, schedule, and planning that works without AI',
  'Garden designer, weather gates, the offline app and push alerts',
  'CSV, PDF, USDA and VDACS exports, the year summary and a full data export',
  'API tokens for your own tools'
] as const;

export const PLAN_HIGHLIGHTS: Record<PlanId, readonly string[]> = {
  free: [
    'Everything that is not AI, with no limits',
    'Owner plus 2 helpers',
    '$0.50 of AI help each month, $1.00 in your first 30 days'
  ],
  grower: [
    'Everything in Free',
    'Owner plus 5 helpers',
    '$4 of AI help each month',
    'AI web search: product lookup, stock refresh and receipt scans'
  ],
  farm: [
    'Everything in Grower',
    'Owner plus 15 helpers',
    '$10 of AI help each month',
    'About double the daily AI limits',
    'Priority email support'
  ]
};

/** What one full AI plan (allocate, schedule and a refine turn) costs on a
 *  typical farm, from the decision record's unit costs. */
export const TYPICAL_PLAN_USD = 0.14;

/** Full AI plans that fit a monthly budget: each one can only start while
 *  spend plus the planning reserve still fits, exactly as the guard checks. */
export function fullPlansFor(budget: number): number {
  let spent = 0;
  let n = 0;
  while (spent + AI_PLAN_RESERVE_USD <= budget + 1e-9) {
    spent += TYPICAL_PLAN_USD;
    n += 1;
  }
  return n;
}

const roundDownTo5 = (n: number) => (n >= 10 ? Math.floor(n / 5) * 5 : n);

export const AI_BUDGET_EXAMPLES: Record<PlanId, string> = {
  free: `About ${fullPlansFor(PLANS.free.aiMonthlyUsd)} full AI plans a month (more in your first 30 days), or around 100 quick lookups.`,
  grower: `About ${roundDownTo5(fullPlansFor(PLANS.grower.aiMonthlyUsd))} full AI plans, or 20 web lookups plus daily quick help.`,
  farm: 'Heavy daily use, receipt scans included.'
};
