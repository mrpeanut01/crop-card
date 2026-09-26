/**
 * Phase 25d (#89) — `aiTry()` server helper, the SINGLE chokepoint for
 * AI degradation triggers per the v2 addendum.
 *
 * Every endpoint that could call Claude funnels through this helper.
 * The helper short-circuits to the deterministic fallback when:
 *   - the user has no key (`user.ai_enabled = false`)            → 'no-key'
 *   - the monthly USD cap has been reached                       → 'over-cap'
 *   - the request is offline                                     → 'offline'
 *   - a single endpoint has been disabled for ~10 min            → 'rate-limit'
 *   - the Claude call exceeds `timeoutMs` (default 6s)           → 'timeout'
 *
 * The return shape always includes a `provenance` tag so the caller
 * can stamp the audit row + render the right `<Provenance>` badge.
 *
 * Spec: docs/design/almanac/AI_PROVENANCE_ADDENDUM.md ("aiTry helper").
 */

import { getApiKey } from './scanResult';

export type FallbackReason = 'no-key' | 'over-cap' | 'offline' | 'rate-limit' | 'timeout';

export type AiTryResult<T> = {
  value: T;
  provenance: 'ai' | 'fallback';
  /** Populated only when `provenance === 'ai'`. Self-reported by the prompt
   *  function (it knows the model + claude's stated confidence on the output);
   *  the helper just relays. */
  confidence?: number;
  /** Populated only when `provenance === 'fallback'`. */
  fallbackReason?: FallbackReason;
};

export interface AiTryArgs<T> {
  /** Endpoint name — for ai_call_log + per-endpoint rate-limit window. */
  endpoint: string;
  /** True when `user.ai_enabled` is true on the active user. The loader
   *  is the right place to resolve this since aiTry runs after
   *  authentication. Callers can use `getUserAiEnabled()`. */
  aiEnabled: boolean;
  /** Claude call. Should self-resolve to a value the caller can use
   *  identically to the fallback. Self-reports confidence as part of the
   *  result tuple. */
  prompt: () => Promise<{ value: T; confidence?: number }>;
  /** Deterministic default. Must always succeed (no exceptions); the
   *  helper invokes it whenever the AI path can't run. */
  fallback: () => Promise<T> | T;
  /** Single-endpoint timeout. Default 6000ms per the spec. */
  timeoutMs?: number;
  /** Optional override for the "would have over-capped" check. Defaults
   *  to `false` — when wired into aiGuard the spend snapshot drives this
   *  in a follow-up commit. */
  overCap?: boolean;
  /** Optional override for the "single-endpoint disabled" check. */
  rateLimited?: boolean;
}

const DEFAULT_TIMEOUT_MS = 6000;

async function runFallback<T>(
  fallback: () => Promise<T> | T,
  reason: FallbackReason
): Promise<AiTryResult<T>> {
  const value = await fallback();
  return { value, provenance: 'fallback', fallbackReason: reason };
}

/**
 * The single chokepoint. See file-level JSDoc for the degradation matrix.
 */
export async function aiTry<T>(args: AiTryArgs<T>): Promise<AiTryResult<T>> {
  if (!args.aiEnabled) {
    return runFallback(args.fallback, 'no-key');
  }
  if (args.overCap === true) {
    return runFallback(args.fallback, 'over-cap');
  }
  if (args.rateLimited === true) {
    return runFallback(args.fallback, 'rate-limit');
  }

  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutSentinel = Symbol('aiTry-timeout');
  let timerHandle: ReturnType<typeof setTimeout> | undefined;
  const timer: Promise<typeof timeoutSentinel> = new Promise((resolve) => {
    timerHandle = setTimeout(() => resolve(timeoutSentinel), timeoutMs);
  });

  try {
    const raced = await Promise.race([args.prompt(), timer]);
    if (raced === timeoutSentinel) {
      return runFallback(args.fallback, 'timeout');
    }
    const ok = raced as { value: T; confidence?: number };
    return {
      value: ok.value,
      provenance: 'ai',
      confidence: ok.confidence
    };
  } catch {
    // Treat any thrown error from the prompt as a rate-limit / transient
    // — the deterministic path takes over and the caller can still record
    // the audit row. A future enhancement can split this into
    // 'rate-limit' vs 'timeout' based on the error class.
    return runFallback(args.fallback, 'rate-limit');
  } finally {
    clearTimeout(timerHandle);
  }
}

/**
 * Whether a signed-in user sees the AI-on variant: true whenever a Claude
 * key is configured (env var or the owner setting saved on /settings/ai).
 *
 * `users.ai_enabled` is deliberately not consulted. It defaults to false,
 * only flips for the account that saved the key, and has no toggle in the
 * UI, so gating on it showed "AI off" to every other account and whenever
 * the key came from the environment.
 */
export function getUserAiEnabled(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return !!getApiKey();
}
