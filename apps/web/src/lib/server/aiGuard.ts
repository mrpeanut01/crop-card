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
import { and, eq, gte, sum } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { aiCallLog, apiTokens } from '$lib/db/schema';
import { type AiEndpointName } from '$lib/schedule/constants';
import { getAiDailyCallQuota, getAiMonthlyUsdCap } from '$lib/schedule/settings';
import { currentOwnerId, unscopedQueryNote } from '$lib/db/tenant';
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

function callsToday(userId: string, endpoint: AiEndpointName): number {
  const dayStart = utcDayStart();
  const rows = db
    .select({ id: aiCallLog.id })
    .from(aiCallLog)
    .where(
      and(
        eq(aiCallLog.userId, userId),
        eq(aiCallLog.endpoint, endpoint),
        gte(aiCallLog.createdAt, new Date(dayStart))
      )
    )
    .all();
  return rows.length;
}

function callsTodayByToken(tokenId: string, endpoint: AiEndpointName): number {
  const dayStart = utcDayStart();
  unscopedQueryNote(
    'per-token quota lookup keys on token id, not owner — branch lives in service-account path'
  );
  const rows = db
    .select({ id: aiCallLog.id })
    .from(aiCallLog)
    .where(
      and(
        eq(aiCallLog.tokenId, tokenId),
        eq(aiCallLog.endpoint, endpoint),
        gte(aiCallLog.createdAt, new Date(dayStart))
      )
    )
    .all();
  return rows.length;
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

function monthlyUsdSpent(): number {
  const monthStart = utcMonthStart();
  const row = db
    .select({ total: sum(aiCallLog.usdEstimate) })
    .from(aiCallLog)
    .where(gte(aiCallLog.createdAt, new Date(monthStart)))
    .get();
  return Number(row?.total ?? 0);
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
  const cap = getAiMonthlyUsdCap();
  const spent = monthlyUsdSpent();
  // Monthly USD cap is GLOBAL across all auth paths — the safety brake
  // against a runaway agent. Never bypassed for service-account tokens.
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
    .values({
      id: randomUUID(),
      ownerId,
      userId: input.userId,
      tokenId: input.tokenId ?? null,
      endpoint: input.endpoint,
      model: input.model,
      inputTokens: input.inputTokens,
      cachedInputTokens: input.cachedInputTokens,
      outputTokens: input.outputTokens,
      usdEstimate: input.usdEstimate,
      success: input.success,
      errorClass: input.errorClass ?? null
    })
    .run();
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
