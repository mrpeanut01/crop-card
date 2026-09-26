/**
 * AI guard middleware (Phase 14, extended Phase 24 Sub-task D):
 *   - per-day call quota, monthly USD cap, mandatory call-log writes.
 *
 * Cap behavior:
 *   - 80% soft warn → result includes `spend.warn` flag for the UI banner.
 *   - 100% hard block → response 402 Payment Required, no model call made.
 *
 * Quota behavior:
 *   - Cookie sessions + personal-use Bearer tokens (isServiceAccount=false):
 *     per-(userId, endpoint, UTC-day) — the historical behavior.
 *   - Service-account Bearer tokens: per-(tokenId, endpoint, UTC-day),
 *     using the token's own daily_quota_* column when set. Lets a runaway
 *     drone share none of the human owner's daily quota.
 *
 * Monthly USD cap stays GLOBAL across both cookie + Bearer + service-account
 * paths — it's the safety brake against a runaway agent. Never per-token.
 *
 * Both checks consult `ai_call_log`, so the audit and the limit share state.
 */

import { randomUUID } from 'node:crypto';
import { and, count, eq, gte, sql, sum } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { aiCallLog, apiTokens } from '$lib/db/schema';
import { type AiEndpointName } from '$lib/schedule/constants';
import { getAiDailyCallQuota, getAiMonthlyUsdCap } from '$lib/schedule/settings';
import { currentOwnerId, tenantValues, unscopedQueryNote, withTenant } from '$lib/db/tenant';
import { incrementUsageCounter } from './superadmin';

/** Phase 24 — per-token quota context passed by hooks.server.ts via
 *  event.locals.tokenId + isServiceAccountToken. When isServiceAccount
 *  is true, checkGuard keys rate-limit on tokenId; otherwise the token
 *  shares the human owner's per-user quota (matches the cookie-session
 *  policy so a personal-use Bearer doesn't get any quota arbitrage). */
export interface TokenQuotaContext {
  tokenId: string;
  isServiceAccount: boolean;
}

/** Map AI endpoint → api_tokens column that holds the per-token override.
 *  Endpoints not in this map use the per-user default for service-account
 *  tokens (Phase 24 MVP). A follow-up may widen this to a JSON column for
 *  full per-endpoint coverage. */
const TOKEN_QUOTA_COLUMN: Partial<Record<AiEndpointName, keyof typeof apiTokens.$inferSelect>> = {
  allocate: 'dailyQuotaAllocate',
  inputs: 'dailyQuotaInputs',
  rationale: 'dailyQuotaStockRefresh', // stock-refresh wraps the rationale endpoint
  'plugin-search': 'dailyQuotaSchedule' // re-using the placeholder column for plugin-search
};

export type GuardOutcome =
  | { ok: true; spend: { monthlyUsdSoFar: number; cap: number; warnAt80: boolean } }
  | { ok: false; reason: 'quota-exceeded' | 'cap-exceeded'; status: 429 | 402; message: string };

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

/** This Owner's spend this month, compared against its own cap. */
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

/** Check before making the model call. Does NOT write to the log; that
 *  happens after the call so successful spend is captured.
 *
 *  Phase 24 — optional `tokenContext`. When the request was Bearer-authed
 *  with a service-account token, hooks.server.ts passes the token id +
 *  flag through here so the quota keys on the token instead of the user.
 *  Personal-use tokens (isServiceAccount=false) and cookie sessions share
 *  the original per-user behavior. */
export function checkGuard(
  userId: string,
  endpoint: AiEndpointName,
  tokenContext?: TokenQuotaContext
): GuardOutcome {
  // Monthly USD caps apply on every auth path — the safety brake against a
  // runaway agent. Never bypassed for service-account tokens.
  const globalCap = globalMonthlyUsdCap();
  if (globalCap > 0 && deploymentUsdSpent() >= globalCap) {
    return {
      ok: false,
      reason: 'cap-exceeded',
      status: 402,
      message:
        'AI assistance is paused for this month across CropCard. Everything still works without it.'
    };
  }
  const cap = getAiMonthlyUsdCap();
  const spent = monthlyUsdSpent();
  if (cap > 0 && spent >= cap) {
    return {
      ok: false,
      reason: 'cap-exceeded',
      status: 402,
      message: `Monthly AI cap of $${cap.toFixed(2)} reached ($${spent.toFixed(2)} spent). Raise the cap on Settings to continue.`
    };
  }

  const useTokenScope = !!tokenContext && tokenContext.isServiceAccount;
  let quota: number;
  let today: number;
  if (useTokenScope) {
    const override = perTokenQuota(tokenContext.tokenId, endpoint);
    quota = override ?? getAiDailyCallQuota()[endpoint];
    today = callsTodayByToken(tokenContext.tokenId, endpoint);
  } else {
    quota = getAiDailyCallQuota()[endpoint];
    today = callsToday(userId, endpoint);
  }

  if (today >= quota) {
    return {
      ok: false,
      reason: 'quota-exceeded',
      status: 429,
      message: useTokenScope
        ? `Service-account token daily ${endpoint} quota of ${quota} reached. Raise it on /settings/api-tokens or wait until UTC midnight.`
        : `Daily ${endpoint} quota of ${quota} reached. Try again tomorrow or raise the quota on Settings.`
    };
  }
  return {
    ok: true,
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

/** Aggregate spend snapshot for the settings UI widget. */
export function spendSnapshot(): {
  monthlyUsdSoFar: number;
  cap: number;
  pctUsed: number;
  warnAt80: boolean;
} {
  const cap = getAiMonthlyUsdCap();
  const spent = monthlyUsdSpent();
  const pct = cap > 0 ? Math.min(1, spent / cap) : 0;
  return { monthlyUsdSoFar: spent, cap, pctUsed: pct, warnAt80: pct >= 0.8 };
}
