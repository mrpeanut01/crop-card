/**
 * AI guard middleware (Phase 14): per-day call quota, monthly USD cap,
 * mandatory call-log writes. All three /api/plan/* endpoints route
 * through this.
 *
 * Cap behavior:
 *   - 80% soft warn → result includes `spend.warn` flag for the UI banner.
 *   - 100% hard block → response 402 Payment Required, no model call made.
 * Quota behavior:
 *   - per-user, per-endpoint, per-UTC-day count.
 *   - exceeded → 429 Too Many Requests.
 *
 * Both checks consult `ai_call_log`, so the audit and the limit share state.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, gte, sum } from 'drizzle-orm';
import { db } from '$lib/db/client';
import { aiCallLog } from '$lib/db/schema';
import { type AiEndpointName } from '$lib/schedule/constants';
import { getAiDailyCallQuota, getAiMonthlyUsdCap } from '$lib/schedule/settings';

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
 *  happens after the call so successful spend is captured. */
export function checkGuard(userId: string, endpoint: AiEndpointName): GuardOutcome {
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
  const quota = getAiDailyCallQuota()[endpoint];
  const today = callsToday(userId, endpoint);
  if (today >= quota) {
    return {
      ok: false,
      reason: 'quota-exceeded',
      status: 429,
      message: `Daily ${endpoint} quota of ${quota} reached. Try again tomorrow or raise the quota on Settings.`
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
  db.insert(aiCallLog)
    .values({
      id: randomUUID(),
      userId: input.userId,
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
