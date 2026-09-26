import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from './auth';
import { recordCall, reserveGuard, type GuardOutcome, type TokenQuotaContext } from './aiGuard';
import { aiTry, type FallbackReason } from './aiTry';
import {
  AnthropicOverloadedError,
  getApiKey,
  NO_KEY_MESSAGE,
  type ScanCallUsage,
  type ScanResult,
  type ScanUsageSink
} from './scanResult';

export type ScanEndpoint = 'scan-label' | 'scan-url' | 'scan-barcode';

/** Vision + long product pages routinely take >6s (aiTry's default). */
export const SCAN_AI_TIMEOUT_MS = 30_000;

export type ScanFallbackBody = ScanResult & {
  found: false;
  source: 'none';
  message: string;
  provenance: 'fallback';
  fallbackReason: FallbackReason;
  retryable?: boolean;
};

export type ScanInputBody = ScanResult & { found: false; source: 'none'; message: string };

export type ScanAiOutcome =
  | { ok: true; result: Partial<ScanResult> }
  | { ok: false; status: number; body: ScanFallbackBody | ScanInputBody };

/** Thrown from inside `call` when the scan's INPUT is unusable (page failed
 *  to load, blocked URL, no product signal) before Claude is consulted. Not
 *  an AI degradation: no call-log row is written and the status passes
 *  through verbatim. */
export class ScanInputError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ScanInputError';
  }
}

export interface RunScanAiArgs {
  event: RequestEvent;
  endpoint: ScanEndpoint;
  /** Noun used in the human fallback message ("label", "page"). */
  subject: string;
  call: (onUsage: ScanUsageSink) => Promise<Partial<ScanResult>>;
  timeoutMs?: number;
}

function tokenContext(event: RequestEvent): TokenQuotaContext | undefined {
  const tokenId = event.locals?.tokenId;
  if (!tokenId) return undefined;
  return { tokenId, isServiceAccount: !!event.locals?.isServiceAccountToken };
}

function fallbackBody(
  reason: FallbackReason,
  message: string,
  retryable?: boolean
): ScanFallbackBody {
  return {
    found: false,
    source: 'none',
    message,
    provenance: 'fallback',
    fallbackReason: reason,
    ...(retryable ? { retryable } : {})
  };
}

/** Anthropic refused the request itself (an unreadable or oversized image,
 *  a malformed prompt): a 4xx other than auth, timeout, conflict or rate
 *  limit. Retrying the same input will not help, so it is not a degradation
 *  and is not reported as `rate-limit`. */
export function isRejectedRequest(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status !== 'number' || status < 400 || status >= 500) return false;
  return ![401, 403, 408, 409, 429].includes(status);
}

/** Runs one scan's Claude call through `aiTry()` + `aiGuard`. Every non-AI
 *  outcome is the deterministic "not found — enter it manually" result with
 *  an honest message; nothing here throws a 500. */
export async function runScanAi(args: RunScanAiArgs): Promise<ScanAiOutcome> {
  const userId = requireUser(args.event).id;
  const tokenCtx = tokenContext(args.event);
  const recordTokenId = tokenCtx?.isServiceAccount ? tokenCtx.tokenId : null;
  const aiEnabled = !!getApiKey();

  const guard: GuardOutcome | null = aiEnabled
    ? reserveGuard(userId, args.endpoint, tokenCtx)
    : null;
  const guardBlock = guard && !guard.ok ? guard : null;
  const hold = guard?.ok ? (guard.hold ?? null) : null;

  const state: { callError: unknown; settledAsTimeout: boolean } = {
    callError: null,
    settledAsTimeout: false
  };

  const log = (
    usage: ScanCallUsage | null,
    outcome: { provenance: 'ai' | 'fallback'; reason?: FallbackReason; errorClass?: string }
  ) => {
    if (usage && usage.inputTokens + usage.outputTokens > 0) hold?.settle(usage.usdEstimate);
    try {
      recordCall({
        userId,
        tokenId: recordTokenId,
        endpoint: args.endpoint,
        model: usage?.model ?? 'none',
        inputTokens: usage?.inputTokens ?? 0,
        cachedInputTokens: usage?.cachedInputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        usdEstimate: usage?.usdEstimate ?? 0,
        success: outcome.provenance === 'ai',
        errorClass: outcome.errorClass,
        provenance: outcome.provenance,
        fallbackReason: outcome.reason ?? null,
        attemptedAiAt: outcome.provenance === 'fallback' ? Date.now() : null
      });
    } catch (err) {
      console.error(`[ai] ${args.endpoint} recordCall failed`, err);
    } finally {
      hold?.release();
    }
  };

  const promptStarted = { value: false };
  const result = await aiTry<Partial<ScanResult>>({
    endpoint: args.endpoint,
    aiEnabled,
    overCap: guardBlock?.reason === 'cap-exceeded',
    rateLimited: guardBlock?.reason === 'quota-exceeded',
    timeoutMs: args.timeoutMs ?? SCAN_AI_TIMEOUT_MS,
    prompt: async () => {
      promptStarted.value = true;
      let usage: ScanCallUsage | null = null;
      try {
        const value = await args.call((u) => (usage = u));
        if (state.settledAsTimeout) log(usage, { provenance: 'fallback', reason: 'timeout' });
        else log(usage, { provenance: 'ai' });
        return { value };
      } catch (err) {
        state.callError = err;
        if (err instanceof ScanInputError) {
          hold?.release();
          throw err;
        }
        const rejected = !state.settledAsTimeout && isRejectedRequest(err);
        log(usage, {
          provenance: 'fallback',
          reason: state.settledAsTimeout ? 'timeout' : rejected ? undefined : 'rate-limit',
          errorClass: rejected
            ? `anthropic-${(err as { status: number }).status}`
            : err instanceof Error
              ? err.name
              : 'unknown'
        });
        throw err;
      }
    },
    fallback: () => ({ found: false })
  });

  if (!promptStarted.value) hold?.release();
  if (result.provenance === 'ai') return { ok: true, result: result.value };

  if (state.callError instanceof ScanInputError) {
    return {
      ok: false,
      status: state.callError.status,
      body: { found: false, source: 'none', message: state.callError.message }
    };
  }

  if (result.fallbackReason === 'rate-limit' && isRejectedRequest(state.callError)) {
    const detail =
      state.callError instanceof Error && state.callError.message
        ? ` (${state.callError.message})`
        : '';
    return {
      ok: false,
      status: 422,
      body: {
        found: false,
        source: 'none',
        message: `Claude could not read this ${args.subject}${detail}. Try a clearer or smaller photo, or use Manual entry.`
      }
    };
  }

  const reason = result.fallbackReason ?? 'rate-limit';
  switch (reason) {
    case 'no-key':
      return { ok: false, status: 503, body: fallbackBody('no-key', NO_KEY_MESSAGE) };
    case 'over-cap':
    case 'rate-limit':
      if (guardBlock) {
        log(null, { provenance: 'fallback', reason });
        return {
          ok: false,
          status: guardBlock.status,
          body: fallbackBody(reason, `${guardBlock.message} Manual entry still works.`)
        };
      }
      if (state.callError instanceof AnthropicOverloadedError) {
        return {
          ok: false,
          status: 503,
          body: fallbackBody('rate-limit', state.callError.message, true)
        };
      }
      return {
        ok: false,
        status: 503,
        body: fallbackBody(
          'rate-limit',
          `Claude could not read the ${args.subject}${
            state.callError instanceof Error && state.callError.message
              ? ` (${state.callError.message})`
              : ''
          }. Try again, or use Manual entry.`,
          true
        )
      };
    case 'timeout':
      state.settledAsTimeout = true;
      return {
        ok: false,
        status: 504,
        body: fallbackBody(
          'timeout',
          `Claude took too long to read the ${args.subject}. Try again, or use Manual entry.`,
          true
        )
      };
    default:
      return {
        ok: false,
        status: 503,
        body: fallbackBody(reason, `AI is unavailable right now. Use Manual entry.`)
      };
  }
}
