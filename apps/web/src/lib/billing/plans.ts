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
  /** Separate monthly ceiling on AI planning spend (see PLANNING_ENDPOINTS). */
  planningMonthlyUsd: number;
  helperSeats: number;
  webSearchAi: boolean;
  prioritySupport: boolean;
  dailyQuota: DailyQuota;
  /** Document vault cap in bytes (decimal: 1 MB = 1,000,000 bytes). The
   *  starter boost never touches it. */
  storageBytes: number;
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
  allocate: 5,
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
  allocate: 25,
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
  allocate: 50,
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
    planningMonthlyUsd: 1.5,
    helperSeats: 2,
    webSearchAi: false,
    prioritySupport: false,
    dailyQuota: FREE_QUOTA,
    storageBytes: 100_000_000
  },
  grower: {
    id: 'grower',
    name: 'Grower',
    monthlyPriceUsd: 10,
    annualPriceUsd: 96,
    aiMonthlyUsd: 4,
    planningMonthlyUsd: 6,
    helperSeats: 5,
    webSearchAi: true,
    prioritySupport: false,
    dailyQuota: GROWER_QUOTA,
    storageBytes: 1_000_000_000
  },
  farm: {
    id: 'farm',
    name: 'Farm',
    monthlyPriceUsd: 20,
    annualPriceUsd: 192,
    aiMonthlyUsd: 10,
    planningMonthlyUsd: 12,
    helperSeats: 15,
    webSearchAi: true,
    prioritySupport: true,
    dailyQuota: FARM_QUOTA,
    storageBytes: 5_000_000_000
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

/** AI planning (allocate, schedule and refine all log as `allocate`) runs on
 *  its daily cap and its own monthly planning budget (`planningMonthlyUsd`),
 *  not on the budget for the other AI help: a Free farm gets its 5 a day
 *  (#479) and a planning day never uses up the other AI help. The planning
 *  budget bounds what one farm can cost against the operator's global cap.
 *  When the owner sets a lower monthly limit, that limit covers all AI spend,
 *  planning included. */
export const PLANNING_ENDPOINTS: ReadonlySet<AiEndpointName> = new Set<AiEndpointName>([
  'allocate'
]);

export const isPlanningEndpoint = (e: AiEndpointName | string): boolean =>
  PLANNING_ENDPOINTS.has(e as AiEndpointName);

/** Below this much left, no AI feature can start. */
export const AI_MIN_RESERVE_USD = Math.min(...Object.values(AI_RESERVE_USD));

/** Below this much left, a web lookup cannot start but quick help can. */
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
  planningMonthlyUsd: number;
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
      planningMonthlyUsd: def.planningMonthlyUsd,
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
  /** Enough left for the smallest AI help but not for a web lookup. */
  quickOnly: boolean;
  /** AI planning runs on its own daily limit and monthly planning budget. */
  planning: {
    perDay: number;
    usedToday: number;
    monthlyUsd: number;
    monthlyUsdSoFar: number;
    monthlyExhausted: boolean;
  };
  /** The owner set a lower limit, which then covers planning too. */
  ownerLimited: boolean;
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
    'Up to 5 AI planning runs a day',
    '$0.50 of other AI help each month, $1.00 in your first 30 days'
  ],
  grower: [
    'Everything in Free',
    'Owner plus 5 helpers',
    'Up to 25 AI planning runs a day',
    '$4 of other AI help each month',
    'AI web search: product lookup, stock refresh and receipt scans'
  ],
  farm: [
    'Everything in Grower',
    'Owner plus 15 helpers',
    'Up to 50 AI planning runs a day',
    '$10 of other AI help each month',
    "About double Grower's daily AI limits",
    'Priority email support'
  ]
};

const planningPerDay = (plan: PlanId) => PLANS[plan].dailyQuota.allocate;

export const AI_BUDGET_EXAMPLES: Record<PlanId, string> = {
  free: `Up to ${planningPerDay('free')} AI planning runs a day, plus around 100 quick lookups a month.`,
  grower: `Up to ${planningPerDay('grower')} AI planning runs a day, plus 20 web lookups and daily quick help.`,
  farm: `Up to ${planningPerDay('farm')} AI planning runs a day and heavy daily use, receipt scans included.`
};
