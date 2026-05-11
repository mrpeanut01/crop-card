/**
 * Phase 17 (Track 3.5) — per-call AI telemetry.
 *
 * Every AI endpoint records one entry here per Claude call. Stores
 * cache-hit ratios, derived-signal hit ratios, and token counts so we
 * can measure whether Track 3.1–3.4 actually reduced spend, not just
 * "moved the cost around."
 *
 * In-process ring buffer (default 200 entries). Exposed via
 * `getRecentAiCalls()` for an admin panel; not persisted to disk in v1.
 * The `getAiCallStatsSummary()` helper produces the rolled-up
 * cache_hit_ratio used by the verification step in the plan file.
 */

const MAX_ENTRIES = 200;

export type AiEndpoint =
  | 'suggest'
  | 'optimize'
  | 'allocate'
  | 'groups'
  | 'rationale'
  | 'shortNames'
  | 'planWithAI';

export interface AiCallEntry {
  endpoint: AiEndpoint;
  /** Claude model id (e.g. 'claude-sonnet-4-6'). */
  model: string;
  /** True when this endpoint hit the in-process farm-context cache. */
  contextCacheHit: boolean;
  /** True when at least one derived signal was reused for this call. */
  derivedSignalHit: boolean;
  inputTokens: number;
  /** From Anthropic usage.cache_read_input_tokens. */
  cachedInputTokens: number;
  outputTokens: number;
  /** Estimated USD cost (computed by the caller using `estimateUsd`). */
  usdEstimate: number;
  /** Wall-clock for the call in ms. */
  durationMs: number;
  /** Anthropic-cache hit ratio for this single call. */
  cacheHitRatio: number;
  occurredAt: number;
  /** Optional planning-session id when threading is enabled. */
  planningSessionId?: string;
}

const ring: AiCallEntry[] = [];

export function recordAiCall(input: {
  endpoint: AiEndpoint;
  model: string;
  contextCacheHit: boolean;
  derivedSignalHit: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  usdEstimate: number;
  durationMs: number;
  planningSessionId?: string;
}): AiCallEntry {
  const total = input.inputTokens + input.cachedInputTokens;
  const entry: AiCallEntry = {
    ...input,
    cacheHitRatio: total === 0 ? 0 : input.cachedInputTokens / total,
    occurredAt: Date.now()
  };
  ring.push(entry);
  if (ring.length > MAX_ENTRIES) ring.shift();
  return entry;
}

export function getRecentAiCalls(limit: number = MAX_ENTRIES): AiCallEntry[] {
  return ring.slice(-limit);
}

export interface AiCallStatsSummary {
  totalCalls: number;
  totalInputTokens: number;
  totalCachedTokens: number;
  totalOutputTokens: number;
  totalUsd: number;
  /** Mean of per-call cache hit ratios. */
  meanCacheHitRatio: number;
  /** Aggregate cache hit ratio (totalCached / (totalInput + totalCached)). */
  aggregateCacheHitRatio: number;
  contextCacheHitRatio: number;
  derivedSignalHitRatio: number;
  byEndpoint: Record<string, { calls: number; usd: number; meanCacheRatio: number }>;
}

export function getAiCallStatsSummary(window?: { sinceMs: number }): AiCallStatsSummary {
  const cutoff = window?.sinceMs ?? 0;
  const entries = ring.filter((e) => e.occurredAt >= cutoff);
  const totalCalls = entries.length;
  let totalInputTokens = 0;
  let totalCachedTokens = 0;
  let totalOutputTokens = 0;
  let totalUsd = 0;
  let cacheRatioSum = 0;
  let contextHits = 0;
  let derivedHits = 0;
  const byEndpoint: Record<string, { calls: number; usd: number; cacheSum: number }> = {};
  for (const e of entries) {
    totalInputTokens += e.inputTokens;
    totalCachedTokens += e.cachedInputTokens;
    totalOutputTokens += e.outputTokens;
    totalUsd += e.usdEstimate;
    cacheRatioSum += e.cacheHitRatio;
    if (e.contextCacheHit) contextHits++;
    if (e.derivedSignalHit) derivedHits++;
    const slot = (byEndpoint[e.endpoint] ??= { calls: 0, usd: 0, cacheSum: 0 });
    slot.calls++;
    slot.usd += e.usdEstimate;
    slot.cacheSum += e.cacheHitRatio;
  }
  const tokensTotal = totalInputTokens + totalCachedTokens;
  const aggregateCacheHitRatio = tokensTotal === 0 ? 0 : totalCachedTokens / tokensTotal;
  const meanCacheHitRatio = totalCalls === 0 ? 0 : cacheRatioSum / totalCalls;
  const byEndpointFinal: AiCallStatsSummary['byEndpoint'] = {};
  for (const [k, v] of Object.entries(byEndpoint)) {
    byEndpointFinal[k] = {
      calls: v.calls,
      usd: v.usd,
      meanCacheRatio: v.calls === 0 ? 0 : v.cacheSum / v.calls
    };
  }
  return {
    totalCalls,
    totalInputTokens,
    totalCachedTokens,
    totalOutputTokens,
    totalUsd,
    meanCacheHitRatio,
    aggregateCacheHitRatio,
    contextCacheHitRatio: totalCalls === 0 ? 0 : contextHits / totalCalls,
    derivedSignalHitRatio: totalCalls === 0 ? 0 : derivedHits / totalCalls,
    byEndpoint: byEndpointFinal
  };
}

export function clearAiCallStats(): void {
  ring.length = 0;
}
