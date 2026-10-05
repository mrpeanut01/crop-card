/** Anthropic's server-side web search is billed per request on top of tokens. */
export const WEB_SEARCH_USD_PER_REQUEST = 0.01;
/** Writing to the prompt cache costs 1.25x the base input rate. */
export const CACHE_WRITE_INPUT_MULTIPLIER = 1.25;

export interface AnthropicUsageLike {
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

/** What `inputTokens` at the base rate misses: the cache-write premium (the
 *  write tokens are already counted once in `inputTokens`) and web search
 *  request fees. */
export function usageSurchargeUsd(
  usage: AnthropicUsageLike | null | undefined,
  inputUsdPerMTok: number
): number {
  if (!usage) return 0;
  const cacheWrite = Number(usage.cache_creation_input_tokens ?? 0) || 0;
  const searches = Number(usage.server_tool_use?.web_search_requests ?? 0) || 0;
  return (
    (cacheWrite / 1_000_000) * inputUsdPerMTok * (CACHE_WRITE_INPUT_MULTIPLIER - 1) +
    searches * WEB_SEARCH_USD_PER_REQUEST
  );
}

/** Thrown by a prompt function when Claude answered (and billed) but the
 *  answer was unusable. `tryAiWithGuard` logs `meta` so the spend still
 *  counts toward the farm's budget and daily cap before degrading. */
export class AiSpentError extends Error {
  constructor(
    message: string,
    readonly meta: {
      model: string;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      usdEstimate: number;
    }
  ) {
    super(message);
    this.name = 'AiSpentError';
  }
}
