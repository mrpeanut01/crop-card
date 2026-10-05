import type { AiEndpointName } from '$lib/schedule/constants';
import { aiLimitReason, type AiLimit } from '$lib/billing/aiLimit';
import { t } from '$lib/i18n';
import { currentOwnerId, runWithTenant } from '$lib/db/tenant';
import { checkGuard, recordCall, reserveGuard, type GuardHold, type GuardOutcome } from './aiGuard';
import { aiTry, type FallbackReason } from './aiTry';
import { AiSpentError } from './aiCost';
import { getApiKey } from './scanResult';

/** Planning + plugin-lookup calls routinely run far longer than aiTry's 6s
 *  default; the underlying modules carry their own SDK timeouts. */
export const LONG_AI_TIMEOUT_MS = 180_000;

export const NO_KEY_FALLBACK_MESSAGE =
  'No Anthropic API key configured — add one on Settings → AI to turn Claude on.';

export const ZERO_USAGE = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  usdEstimate: 0
} as const;

/** Legacy `meta.fallback` tag the planning UIs already branch on. */
export type DegradeTag = 'no-api-key' | 'quota-exceeded' | 'ai-unavailable';

export function degradeTag(reason: FallbackReason, guard: GuardOutcome): DegradeTag {
  if (reason === 'no-key') return 'no-api-key';
  if (!guard.ok) return 'quota-exceeded';
  return 'ai-unavailable';
}

export type DegradeOutcome<T> =
  | { provenance: 'ai'; value: T; guard: GuardOutcome }
  | {
      provenance: 'fallback';
      value: null;
      fallbackReason: FallbackReason;
      fallbackMessage: string;
      error: unknown;
      guard: GuardOutcome;
    };

export interface CallUsage {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  usdEstimate: number;
}

export interface TryAiWithGuardArgs<T> {
  endpoint: AiEndpointName;
  userId: string;
  /** The signal aborts when aiTry gives up on the call (timeout); prompt
   *  functions that thread it into the SDK get the request cancelled. The
   *  hold is this call's budget reservation, for prompts that make several
   *  model calls and need to re-check the budget between them. */
  prompt: (signal: AbortSignal, hold: GuardHold | null) => Promise<T>;
  timeoutMs?: number;
  /** Token usage carried by a resolved value, for metering a call that
   *  settles after the timeout. Defaults to reading `value.meta`. */
  usageOf?: (value: T) => CallUsage | null;
  /** The viewer's language for `fallbackMessage`. Leave unset when the
   *  message is stored or sent to Claude. */
  locale?: string | null;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Every AI module returns `{ ..., meta: AiResultMeta }`; read it defensively. */
export function usageFromMeta(value: unknown): CallUsage | null {
  if (!value || typeof value !== 'object') return null;
  const meta = (value as { meta?: unknown }).meta;
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as Record<string, unknown>;
  if (
    !isFiniteNumber(m.inputTokens) ||
    !isFiniteNumber(m.outputTokens) ||
    !isFiniteNumber(m.usdEstimate)
  ) {
    return null;
  }
  return {
    model: typeof m.model === 'string' ? m.model : 'unknown',
    inputTokens: m.inputTokens,
    cachedInputTokens: isFiniteNumber(m.cachedInputTokens) ? m.cachedInputTokens : 0,
    outputTokens: m.outputTokens,
    usdEstimate: m.usdEstimate
  };
}

/** A timed-out Claude call keeps running (and billing) unless its prompt
 *  honours the abort signal. When it eventually resolves, write its real
 *  usage so the spend counts toward the monthly cap + daily quota — the
 *  caller's zero-token `recordFallback` row covers only the audit. The
 *  tenant id is captured before the request returns and re-entered here so
 *  the row lands on the right Owner however the SDK schedules the settle. */
function meterLateSettle<T>(
  pending: Promise<T>,
  args: TryAiWithGuardArgs<T>,
  ownerId: string | null,
  hold: GuardHold | null
): void {
  const usageOf = args.usageOf ?? usageFromMeta;
  pending.then(
    (value) => {
      const usage = usageOf(value);
      if (!usage || usage.inputTokens + usage.outputTokens + usage.usdEstimate <= 0) {
        hold?.release();
        return;
      }
      hold?.settle(usage.usdEstimate);
      const write = () =>
        recordCall({
          userId: args.userId,
          endpoint: args.endpoint,
          model: usage.model,
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          usdEstimate: usage.usdEstimate,
          success: false,
          errorClass: 'timeout',
          provenance: 'fallback',
          fallbackReason: 'timeout',
          attemptedAiAt: Date.now()
        });
      try {
        if (ownerId) runWithTenant(ownerId, write);
        else write();
      } catch (err) {
        console.error(`[ai] ${args.endpoint} late recordCall failed`, err);
      } finally {
        hold?.release();
      }
    },
    () => hold?.release()
  );
}

/** Claude answered but the prompt function threw: the call was still billed,
 *  so its usage is logged against the farm's budget and daily cap. */
function meterSpentError<T>(
  err: AiSpentError,
  args: TryAiWithGuardArgs<T>,
  reason: FallbackReason,
  hold: GuardHold | null
): void {
  const usage = usageFromMeta({ meta: err.meta });
  if (!usage || usage.inputTokens + usage.outputTokens <= 0) return;
  hold?.settle(usage.usdEstimate);
  try {
    recordCall({
      userId: args.userId,
      endpoint: args.endpoint,
      model: usage.model,
      inputTokens: usage.inputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens,
      usdEstimate: usage.usdEstimate,
      success: false,
      errorClass: 'invalid-response',
      provenance: 'fallback',
      fallbackReason: reason,
      attemptedAiAt: Date.now()
    });
  } catch (e) {
    console.error(`[ai] ${args.endpoint} recordCall failed`, e);
  }
}

/** The guard's refusal, trimmed to what a banner and upgrade nudge need. */
export function aiLimitOf(guard: GuardOutcome): AiLimit | null {
  if (guard.ok || !guard.detail) return null;
  return { detail: guard.detail, plan: guard.plan ?? null, upgrade: guard.upgrade ?? null };
}

export function fallbackMessageFor(
  reason: FallbackReason,
  guard: GuardOutcome,
  error: unknown,
  locale?: string | null
): string {
  const english = !locale || locale === 'en';
  if (reason === 'no-key')
    return english ? NO_KEY_FALLBACK_MESSAGE : t(locale, 'billing.degrade.noKey');
  if (!guard.ok && (reason === 'over-cap' || reason === 'rate-limit')) {
    const limit = english ? null : aiLimitOf(guard);
    return limit
      ? t(locale, 'billing.degrade.limited', { reason: aiLimitReason(limit, locale) })
      : guard.message;
  }
  if (reason === 'timeout') return t(locale, 'billing.degrade.timeout');
  if (reason === 'offline') return t(locale, 'billing.degrade.offline');
  const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
  return t(locale, 'billing.degrade.unavailable', { detail });
}

/** Guard + aiTry in one step for endpoints whose deterministic path lives in
 *  the caller. The degradation decision is aiTry's; this only resolves the
 *  inputs (key present, guard verdict) and the human copy for the banner. */
export async function tryAiWithGuard<T>(args: TryAiWithGuardArgs<T>): Promise<DegradeOutcome<T>> {
  const aiEnabled = !!getApiKey();
  const guard: GuardOutcome = aiEnabled
    ? reserveGuard(args.userId, args.endpoint)
    : checkGuard(args.userId, args.endpoint);
  const hold = guard.ok ? (guard.hold ?? null) : null;
  const ownerId = currentOwnerId();
  const controller = new AbortController();
  const state: { error: unknown; pending: Promise<T> | null } = { error: null, pending: null };
  let keepHold = false;
  try {
    const tried = await aiTry<T | null>({
      endpoint: args.endpoint,
      aiEnabled,
      overCap: !guard.ok && guard.reason === 'cap-exceeded',
      rateLimited: !guard.ok && guard.reason === 'quota-exceeded',
      timeoutMs: args.timeoutMs ?? LONG_AI_TIMEOUT_MS,
      prompt: async () => {
        try {
          state.pending = args.prompt(controller.signal, hold);
          return { value: await state.pending };
        } catch (err) {
          state.error = err;
          throw err;
        }
      },
      fallback: () => null
    });
    if (tried.provenance === 'ai') {
      const usage = (args.usageOf ?? usageFromMeta)(tried.value as T);
      if (hold && usage && usage.inputTokens + usage.outputTokens > 0) {
        hold.settle(usage.usdEstimate);
        keepHold = true;
      }
      return { provenance: 'ai', value: tried.value as T, guard };
    }
    const reason = tried.fallbackReason ?? 'rate-limit';
    if (reason === 'timeout' && state.pending) {
      controller.abort();
      meterLateSettle(state.pending, args, ownerId, hold);
      keepHold = true;
    } else if (state.error instanceof AiSpentError) {
      meterSpentError(state.error, args, reason, hold);
    }
    return {
      provenance: 'fallback',
      value: null,
      fallbackReason: reason,
      fallbackMessage: fallbackMessageFor(reason, guard, state.error, args.locale),
      error: state.error,
      guard
    };
  } finally {
    if (!keepHold) hold?.release();
  }
}

/** Zero-token audit row for a deterministic response. Zero-token rows do not
 *  count toward the daily quota (see aiGuard.consumedTokens). */
export function recordFallback(
  userId: string,
  endpoint: AiEndpointName,
  reason: FallbackReason,
  errorClass?: string
): void {
  try {
    recordCall({
      userId,
      endpoint,
      model: 'engine-fallback',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      usdEstimate: 0,
      success: true,
      errorClass: errorClass ?? reason,
      provenance: 'fallback',
      fallbackReason: reason,
      attemptedAiAt: Date.now()
    });
  } catch (err) {
    console.error(`[ai] ${endpoint} recordCall failed`, err);
  }
}
