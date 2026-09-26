/**
 * AI guard: per-plan monthly USD budget, per-feature daily caps, the free
 * pool and the operator's deployment brake, checked before every Claude
 * call. Every outcome that is not `ok` degrades through aiTry to the
 * deterministic path; nothing here ever blocks a non-AI feature.
 *
 * Order: deployment brake, owner switched AI off, feature not in the plan,
 * monthly budget (spent + the call's worst-case reserve), free pool, daily
 * cap. The monthly budget is per Owner, so helpers and Bearer tokens spend
 * the same budget. Service-account tokens key their daily count on the
 * token instead of the user.
 */

import { randomUUID } from 'node:crypto';
import { and, count, eq, gte, inArray, notInArray, sql, sum } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { aiCallLog, apiTokens, ownerSubscriptions, owners } from '$lib/db/schema';
import { type AiEndpointName } from '$lib/schedule/constants';
import { getAiDailyCallQuotaOverrides, getAiMonthlyUsdCapSetting } from '$lib/schedule/settings';
import { currentOwnerId, tenantValues, unscopedQueryNote, withTenant } from '$lib/db/tenant';
import {
  AI_RESERVE_USD,
  DEFAULT_FREE_POOL_MONTHLY_USD,
  PLANS,
  effectiveDailyQuota,
  effectiveMonthlyCap,
  formatUsd,
  nextPlanUp,
  resolvePlanFrom,
  type AiUsageSnapshot,
  type PaidPlanId,
  type PlanId,
  type ResolvedPlan
} from '$lib/billing/plans';
import { resolvePlan } from './billing/plans';
import { incrementUsageCounter } from './superadmin';

export interface TokenQuotaContext {
  tokenId: string;
  isServiceAccount: boolean;
}

const TOKEN_QUOTA_COLUMN: Partial<Record<AiEndpointName, keyof typeof apiTokens.$inferSelect>> = {
  allocate: 'dailyQuotaAllocate',
  inputs: 'dailyQuotaInputs',
  rationale: 'dailyQuotaStockRefresh',
  'plugin-search': 'dailyQuotaSchedule'
};

export type GuardBlockDetail =
  | 'global'
  | 'owner-disabled'
  | 'plan-excluded'
  | 'monthly-budget'
  | 'free-pool'
  | 'daily-quota'
  | 'token-quota';

export type GuardOutcome =
  | {
      ok: true;
      spend: { monthlyUsdSoFar: number; cap: number; warnAt80: boolean };
      plan?: PlanId;
    }
  | {
      ok: false;
      reason: 'quota-exceeded' | 'cap-exceeded';
      status: 429 | 402;
      message: string;
      detail?: GuardBlockDetail;
      plan?: PlanId;
      upgrade?: PaidPlanId | null;
    };

function utcDayStart(now = Date.now()): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function utcMonthStart(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
}

// Rows with zero tokens never reached Claude (no-key / deterministic
// fallback / guard rejection). Counting them would let the deterministic
// path exhaust the AI quota and then 429 a no-key user (Invariant 7).
const consumedTokens = sql`(${aiCallLog.inputTokens} + ${aiCallLog.cachedInputTokens} + ${aiCallLog.outputTokens}) > 0`;

function callsToday(userId: string, endpoint: AiEndpointName): number {
  const dayStart = utcDayStart();
  unscopedQueryNote(
    'per-user daily quota counts the user across every Owner they belong to, keyed on user id'
  );
  const row = db
    .select({ n: count() })
    .from(aiCallLog)
    .where(
      and(
        eq(aiCallLog.userId, userId),
        eq(aiCallLog.endpoint, endpoint),
        gte(aiCallLog.createdAt, new Date(dayStart)),
        consumedTokens
      )
    )
    .get();
  return row?.n ?? 0;
}

function callsTodayByToken(tokenId: string, endpoint: AiEndpointName): number {
  const dayStart = utcDayStart();
  unscopedQueryNote(
    'per-token quota lookup keys on token id, not owner — branch lives in service-account path'
  );
  const row = db
    .select({ n: count() })
    .from(aiCallLog)
    .where(
      and(
        eq(aiCallLog.tokenId, tokenId),
        eq(aiCallLog.endpoint, endpoint),
        gte(aiCallLog.createdAt, new Date(dayStart)),
        consumedTokens
      )
    )
    .get();
  return row?.n ?? 0;
}

function perTokenQuota(tokenId: string, endpoint: AiEndpointName): number | null {
  const column = TOKEN_QUOTA_COLUMN[endpoint];
  if (!column) return null;
  unscopedQueryNote(
    'read per-token quota override; row is owner-scoped so this is safe by composite key on id'
  );
  const row = db.select().from(apiTokens).where(eq(apiTokens.id, tokenId)).get();
  if (!row) return null;
  const v = row[column];
  return typeof v === 'number' ? v : null;
}

/** This Owner's spend this month, whoever on the farm made the call. */
function monthlyUsdSpent(): number {
  const monthStart = utcMonthStart();
  const row = db
    .select({ total: sum(aiCallLog.usdEstimate) })
    .from(aiCallLog)
    .where(withTenant(aiCallLog, gte(aiCallLog.createdAt, new Date(monthStart))))
    .get();
  return Number(row?.total ?? 0);
}

/** Deployment-wide brake on the shared Anthropic key, set by the operator
 *  (`AI_GLOBAL_MONTHLY_USD_CAP`), never by a farm. Unset or 0 = off. */
export function globalMonthlyUsdCap(): number {
  const n = Number(process.env.AI_GLOBAL_MONTHLY_USD_CAP ?? '');
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Ceiling on all free-plan AI spend in a month. Unset = $50; 0 = off. */
export function freePoolMonthlyUsd(): number {
  const raw = process.env.AI_FREE_POOL_MONTHLY_USD;
  if (raw == null || raw.trim() === '') return DEFAULT_FREE_POOL_MONTHLY_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// The deployment-wide sum reads every row this month, so it is memoised and
// topped up by recordCall(). Single replica (Invariant 3) keeps this exact
// between refreshes; the refresh picks up anything written out of band.
const DEPLOYMENT_SPEND_TTL_MS = 60_000;
let deploymentSpendMemo: { monthStart: number; total: number; at: number } | null = null;

export function resetDeploymentSpendMemo(): void {
  deploymentSpendMemo = null;
}

function deploymentUsdSpent(now = Date.now()): number {
  const monthStart = utcMonthStart(now);
  const memo = deploymentSpendMemo;
  if (memo && memo.monthStart === monthStart && now - memo.at < DEPLOYMENT_SPEND_TTL_MS) {
    return memo.total;
  }
  unscopedQueryNote(
    'operator-set deployment-wide brake on the shared Anthropic key, summed across all Owners; the total is never shown to a farm'
  );
  const row = db
    .select({ total: sum(aiCallLog.usdEstimate) })
    .from(aiCallLog)
    .where(gte(aiCallLog.createdAt, new Date(monthStart)))
    .get();
  const total = Number(row?.total ?? 0);
  deploymentSpendMemo = { monthStart, total, at: now };
  return total;
}

const FREE_POOL_CACHE_MS = 60_000;
let freePoolCache: { monthStart: number; at: number; total: number } | null = null;

export function resetFreePoolCache(): void {
  freePoolCache = null;
}

function freePoolUsdSpent(now = Date.now()): number {
  const monthStart = utcMonthStart(now);
  if (
    freePoolCache &&
    freePoolCache.monthStart === monthStart &&
    now - freePoolCache.at < FREE_POOL_CACHE_MS
  ) {
    return freePoolCache.total;
  }
  unscopedQueryNote('free pool brake sums this month of AI spend across every free-plan Owner');
  const paidBySubscription = db
    .select({ ownerId: ownerSubscriptions.ownerId })
    .from(ownerSubscriptions)
    .where(
      and(
        inArray(ownerSubscriptions.planCode, ['grower', 'farm']),
        inArray(ownerSubscriptions.status, ['active', 'trial', 'past_due'])
      )
    );
  const paidByOverride = db
    .select({ id: owners.id })
    .from(owners)
    .where(inArray(owners.planOverride, ['grower', 'farm']));
  const row = db
    .select({ total: sum(aiCallLog.usdEstimate) })
    .from(aiCallLog)
    .where(
      and(
        gte(aiCallLog.createdAt, new Date(monthStart)),
        notInArray(aiCallLog.ownerId, paidBySubscription),
        notInArray(aiCallLog.ownerId, paidByOverride)
      )
    )
    .get();
  const total = Number(row?.total ?? 0);
  freePoolCache = { monthStart, at: now, total };
  return total;
}

function activePlan(): ResolvedPlan {
  const ownerId = currentOwnerId();
  if (ownerId) return resolvePlan(ownerId);
  return resolvePlanFrom({
    planOverride: null,
    subscription: null,
    ownerCreatedAt: 0,
    boostEligible: false,
    now: Date.now()
  });
}

function upsell(plan: PlanId): string {
  const next = nextPlanUp(plan);
  return next ? ` More AI on ${PLANS[next].name}.` : '';
}

const WITHOUT_AI = 'CropCard worked this out without AI instead.';

function blocked(
  reason: 'quota-exceeded' | 'cap-exceeded',
  detail: GuardBlockDetail,
  plan: PlanId | undefined,
  message: string,
  upgrade: PaidPlanId | null = plan ? nextPlanUp(plan) : null
): GuardOutcome {
  return {
    ok: false,
    reason,
    status: reason === 'cap-exceeded' ? 402 : 429,
    message,
    detail,
    plan,
    upgrade
  };
}

/** Check before making the model call. Does NOT write to the log; that
 *  happens after the call so real spend is captured. */
export function checkGuard(
  userId: string,
  endpoint: AiEndpointName,
  tokenContext?: TokenQuotaContext,
  pendingUsd = 0
): GuardOutcome {
  const globalCap = globalMonthlyUsdCap();
  if (globalCap > 0 && deploymentUsdSpent() >= globalCap) {
    return blocked(
      'cap-exceeded',
      'global',
      undefined,
      'AI help is paused for this month across CropCard. Everything still works without it.'
    );
  }

  const plan = activePlan();
  const ownerSetting = getAiMonthlyUsdCapSetting();
  if (ownerSetting === 0) {
    return blocked(
      'cap-exceeded',
      'owner-disabled',
      plan.plan,
      `AI help is turned off for this farm. ${WITHOUT_AI} Turn it back on in Settings, AI.`,
      null
    );
  }

  const quotas = effectiveDailyQuota(plan.dailyQuota, getAiDailyCallQuotaOverrides());
  if (plan.dailyQuota[endpoint] <= 0) {
    return blocked(
      'cap-exceeded',
      'plan-excluded',
      plan.plan,
      `This AI feature is not part of the ${PLANS[plan.plan].name} plan. ${WITHOUT_AI}${upsell(plan.plan)}`
    );
  }

  const cap = effectiveMonthlyCap(plan.aiMonthlyUsd, ownerSetting);
  const spent = monthlyUsdSpent() + pendingUsd;
  if (spent + AI_RESERVE_USD[endpoint] > cap) {
    const ownerLowered = cap < plan.aiMonthlyUsd;
    return blocked(
      'cap-exceeded',
      'monthly-budget',
      plan.plan,
      ownerLowered
        ? `This farm's AI help for the month is used up (${formatUsd(spent)} of the ${formatUsd(cap)} you set). ${WITHOUT_AI} It resets on the 1st.`
        : `You've used this month's AI help (${formatUsd(spent)} of ${formatUsd(cap)}). ${WITHOUT_AI} It resets on the 1st.${upsell(plan.plan)}`
    );
  }

  if (plan.plan === 'free') {
    const pool = freePoolMonthlyUsd();
    if (pool > 0 && freePoolUsdSpent() >= pool) {
      return blocked(
        'cap-exceeded',
        'free-pool',
        plan.plan,
        `Free AI help is resting until the 1st because so many farms are using it. ${WITHOUT_AI}${upsell(plan.plan)}`
      );
    }
  }

  const useTokenScope = !!tokenContext && tokenContext.isServiceAccount;
  let quota: number;
  let today: number;
  if (useTokenScope) {
    const override = perTokenQuota(tokenContext.tokenId, endpoint);
    quota = override ?? quotas[endpoint];
    today = callsTodayByToken(tokenContext.tokenId, endpoint);
  } else {
    quota = quotas[endpoint];
    today = callsToday(userId, endpoint);
  }

  if (today >= quota) {
    return blocked(
      'quota-exceeded',
      useTokenScope ? 'token-quota' : 'daily-quota',
      plan.plan,
      useTokenScope
        ? `Service-account token daily ${endpoint} quota of ${quota} reached. Raise it on /settings/api-tokens or wait until UTC midnight.`
        : `Today's ${endpoint} AI limit of ${quota} is used up. ${WITHOUT_AI} It resets at midnight UTC.${upsell(plan.plan)}`
    );
  }
  return {
    ok: true,
    plan: plan.plan,
    spend: {
      monthlyUsdSoFar: spent,
      cap,
      warnAt80: cap > 0 && spent >= 0.8 * cap
    }
  };
}

export interface RecordCallInput {
  userId: string | null;
  /** Phase 24 — when the call was Bearer-authed under a service-account
   *  token, stamping the row lets callsTodayByToken() see it on the next
   *  iteration. Null for cookie sessions and personal-use Bearer tokens. */
  tokenId?: string | null;
  endpoint: AiEndpointName | 'rationale';
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  usdEstimate: number;
  success: boolean;
  errorClass?: string;
  // ─── Phase 25d (#89 / #93) — v2 addendum provenance fields ────────
  /** 'ai' for a successful Claude call routed via aiTry();
   *  'fallback' when aiTry() picked the deterministic path; null/absent
   *  for legacy callers (pre-25d AI sites that still call recordCall
   *  directly without going through aiTry). */
  provenance?: 'ai' | 'fallback' | null;
  /** Claude self-reported confidence (0..1); populated only for
   *  `provenance='ai'`. */
  confidence?: number | null;
  /** Why the deterministic path ran; populated only for
   *  `provenance='fallback'`. */
  fallbackReason?: 'no-key' | 'over-cap' | 'offline' | 'rate-limit' | 'timeout' | null;
  /** Wall time the (failed/skipped) AI call would have happened. Used
   *  by /api/audit/re-ask-ai to re-run fallback rows once a key is
   *  configured (Phase 26 follow-up). */
  attemptedAiAt?: number | null;
}

export function recordCall(input: RecordCallInput): void {
  // Phase 18a/g: aiCallLog is tenant-scoped; stamp the active owner alongside
  // the audit row. Bump the usage counter for the (owner, current period) so
  // metered-billing has data on day one. AI calls outside a tenant context
  // are vanishingly rare (background jobs); when they happen, skip the log
  // rather than write a NULL owner_id that violates the NOT NULL invariant.
  const ownerId = currentOwnerId();
  if (!ownerId) {
    console.warn('[ai] recordCall outside tenant context; skipping ai_call_log entry');
    return;
  }
  db.insert(aiCallLog)
    .values(
      tenantValues({
        id: randomUUID(),
        userId: input.userId,
        tokenId: input.tokenId ?? null,
        endpoint: input.endpoint,
        model: input.model,
        inputTokens: input.inputTokens,
        cachedInputTokens: input.cachedInputTokens,
        outputTokens: input.outputTokens,
        usdEstimate: input.usdEstimate,
        success: input.success,
        errorClass: input.errorClass ?? null,
        // Phase 25d (#89 / #93) — provenance fields. All nullable so
        // legacy call sites don't need updating; they write null for now
        // and migrate to populate when they're moved onto aiTry().
        provenance: input.provenance ?? null,
        confidence: input.confidence ?? null,
        fallbackReason: input.fallbackReason ?? null,
        attemptedAiAt: input.attemptedAiAt != null ? new Date(input.attemptedAiAt) : null
      })
    )
    .run();
  if (deploymentSpendMemo && input.usdEstimate > 0) {
    deploymentSpendMemo.total += input.usdEstimate;
  }
  try {
    incrementUsageCounter(ownerId, { aiCalls: 1 });
  } catch (err) {
    console.error('[usage] failed to increment ai_calls counter', err);
  }
}

export type SpendSnapshot = AiUsageSnapshot;

/** Spend against this farm's plan budget, for the settings pages and the
 *  compact meter next to AI buttons. */
export function spendSnapshot(): SpendSnapshot {
  const plan = activePlan();
  const ownerSetting = getAiMonthlyUsdCapSetting();
  const cap = effectiveMonthlyCap(plan.aiMonthlyUsd, ownerSetting);
  const spent = monthlyUsdSpent();
  const pct = cap > 0 ? Math.min(1, spent / cap) : 1;
  return {
    monthlyUsdSoFar: spent,
    cap,
    planBudget: plan.aiMonthlyUsd,
    pctUsed: pct,
    warnAt80: pct >= 0.8,
    exhausted: cap <= 0 || spent >= cap,
    aiOff: ownerSetting === 0,
    plan: plan.plan,
    planName: PLANS[plan.plan].name,
    planSource: plan.source,
    starterBoost: plan.starterBoost,
    boostEndsAt: plan.boostEndsAt,
    graceEndsAt: plan.graceEndsAt,
    upgrade: nextPlanUp(plan.plan)
  };
}
