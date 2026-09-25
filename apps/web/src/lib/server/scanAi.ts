import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from './auth';
import { checkGuard, recordCall, type GuardOutcome, type TokenQuotaContext } from './aiGuard';
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

/** Runs one scan's Claude call through `aiTry()` + `aiGuard`. Every non-AI
 *  outcome is the deterministic "not found — enter it manually" result with
 *  an honest message; nothing here throws a 500. */
export async function runScanAi(args: RunScanAiArgs): Promise<ScanAiOutcome> {
  const userId = requireUser(args.event).id;
  const tokenCtx = tokenContext(args.event);
  const recordTokenId = tokenCtx?.isServiceAccount ? tokenCtx.tokenId : null;
  const aiEnabled = !!getApiKey();

  const guard: GuardOutcome | null = aiEnabled ? checkGuard(userId, args.endpoint, tokenCtx) : null;
  const guardBlock = guard && !guard.ok ? guard : null;

  const state: { callError: unknown; settledAsTimeout: boolean } = {
    callError: null,
    settledAsTimeout: false
  };

  const log = (
    usage: ScanCallUsage | null,
    outcome: { provenance: 'ai' | 'fallback'; reason?: FallbackReason; errorClass?: string }
  ) => {
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
    }
  };

  const result = await aiTry<Partial<ScanResult>>({
    endpoint: args.endpoint,
    aiEnabled,
    overCap: guardBlock?.reason === 'cap-exceeded',
    rateLimited: guardBlock?.reason === 'quota-exceeded',
    timeoutMs: args.timeoutMs ?? SCAN_AI_TIMEOUT_MS,
    prompt: async () => {
      let usage: ScanCallUsage | null = null;
      try {
        const value = await args.call((u) => (usage = u));
        if (state.settledAsTimeout) log(usage, { provenance: 'fallback', reason: 'timeout' });
        else log(usage, { provenance: 'ai' });
        return { value };
      } catch (err) {
        state.callError = err;
        if (err instanceof ScanInputError) throw err;
        log(usage, {
          provenance: 'fallback',
          reason: state.settledAsTimeout ? 'timeout' : 'rate-limit',
          errorClass: err instanceof Error ? err.name : 'unknown'
        });
        throw err;
      }
    },
    fallback: () => ({ found: false })
  });

  if (result.provenance === 'ai') return { ok: true, result: result.value };

  if (state.callError instanceof ScanInputError) {
    return {
      ok: false,
      status: state.callError.status,
      body: { found: false, source: 'none', message: state.callError.message }
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
