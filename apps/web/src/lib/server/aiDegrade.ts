import type { AiEndpointName } from '$lib/schedule/constants';
import { checkGuard, recordCall, type GuardOutcome } from './aiGuard';
import { aiTry, type FallbackReason } from './aiTry';
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

export interface TryAiWithGuardArgs<T> {
  endpoint: AiEndpointName;
  userId: string;
  prompt: () => Promise<T>;
  timeoutMs?: number;
}

export function fallbackMessageFor(
  reason: FallbackReason,
  guard: GuardOutcome,
  error: unknown
): string {
  if (reason === 'no-key') return NO_KEY_FALLBACK_MESSAGE;
  if (!guard.ok && (reason === 'over-cap' || reason === 'rate-limit')) return guard.message;
  if (reason === 'timeout') return 'Claude took too long to respond.';
  if (reason === 'offline') return 'Claude is unreachable (offline).';
  const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
  return `Claude is unavailable right now${detail}.`;
}

/** Guard + aiTry in one step for endpoints whose deterministic path lives in
 *  the caller. The degradation decision is aiTry's; this only resolves the
 *  inputs (key present, guard verdict) and the human copy for the banner. */
export async function tryAiWithGuard<T>(args: TryAiWithGuardArgs<T>): Promise<DegradeOutcome<T>> {
  const guard = checkGuard(args.userId, args.endpoint);
  const state: { error: unknown } = { error: null };
  const tried = await aiTry<T | null>({
    endpoint: args.endpoint,
    aiEnabled: !!getApiKey(),
    overCap: !guard.ok && guard.reason === 'cap-exceeded',
    rateLimited: !guard.ok && guard.reason === 'quota-exceeded',
    timeoutMs: args.timeoutMs ?? LONG_AI_TIMEOUT_MS,
    prompt: async () => {
      try {
        return { value: await args.prompt() };
      } catch (err) {
        state.error = err;
        throw err;
      }
    },
    fallback: () => null
  });
  if (tried.provenance === 'ai') return { provenance: 'ai', value: tried.value as T, guard };
  const reason = tried.fallbackReason ?? 'rate-limit';
  return {
    provenance: 'fallback',
    value: null,
    fallbackReason: reason,
    fallbackMessage: fallbackMessageFor(reason, guard, state.error),
    error: state.error,
    guard
  };
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
