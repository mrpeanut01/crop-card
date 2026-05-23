/**
 * AI planning helper (Phase 14 — Plan-Schedule).
 *
 * Wraps the Anthropic SDK with:
 *   - per-task model selection (Haiku for cheap suggest/succession, Sonnet
 *     for optimize / rationale)
 *   - prompt-cached system block (farm metadata, block list, crop catalog,
 *     frost dates, shade rules — rarely changes mid-session)
 *   - structured-JSON forced output via `response_format`-style instruction
 *   - low max_tokens deliberately, to keep cost bounded
 *
 * Pricing reference (January 2026):
 *   Haiku 4.5  — input $1.00 / MTok, cached $0.10 / MTok, output $5.00 / MTok
 *   Sonnet 4.6 — input $3.00 / MTok, cached $0.30 / MTok, output $15.00 / MTok
 */

import Anthropic from '@anthropic-ai/sdk';
import { getApiKey } from './scanResult';
import { appendTurn, buildThreadedMessages } from './aiPlanningSession';
import { recordAiCall } from './aiCallStats';

export type AiTask =
  | 'suggest'
  | 'succession'
  | 'optimize'
  | 'rationale'
  | 'allocate'
  | 'groups'
  | 'shortNames'
  /** Phase 21 / B-27 — input substitution + tank-mix consolidation
   *  pass on top of the deterministic InputsPlan. Uses Haiku
   *  (substitution lookup is comparatively simple). */
  | 'inputs';

export interface ModelChoice {
  model: string;
  pricing: {
    inputUsdPerMTok: number;
    cachedInputUsdPerMTok: number;
    outputUsdPerMTok: number;
  };
}

const HAIKU: ModelChoice = {
  model: 'claude-haiku-4-5-20251001',
  pricing: { inputUsdPerMTok: 1.0, cachedInputUsdPerMTok: 0.1, outputUsdPerMTok: 5.0 }
};

const SONNET: ModelChoice = {
  model: 'claude-sonnet-4-6',
  pricing: { inputUsdPerMTok: 3.0, cachedInputUsdPerMTok: 0.3, outputUsdPerMTok: 15.0 }
};

export function selectModel(task: AiTask): ModelChoice {
  if (task === 'optimize' || task === 'rationale' || task === 'allocate' || task === 'groups')
    return SONNET;
  return HAIKU;
}

export interface FarmContext {
  /** Lat/lon for shading + weather context. */
  latLon: { lat: number; lon: number };
  /** Frost dates for the active year. */
  lastFrostMs: number;
  firstFrostMs: number;
  /** Block ids → axes + acres + sun exposure. */
  blocks: ReadonlyArray<{
    id: string;
    label: string;
    eastWestIndex: number | null;
    northSouthIndex: number | null;
    acres: number | null;
    sunExposure: 'full' | 'partial' | 'shade' | null;
  }>;
  /** Crop catalog: id → family + DTM + shadeCasting. */
  cropCatalog: ReadonlyArray<{
    pluginId: string;
    family: string;
    dtmMin: number | null;
    dtmMax: number | null;
    shadeCasting: boolean;
    matureHeightFt?: number;
  }>;
}

/** Phase 17 (Track 3.2) — small invariant header. Same bytes for every
 *  AI endpoint regardless of task, so this block always hits the
 *  Anthropic ephemeral prompt cache when reused within ~5 minutes. */
function buildFarmSystemPromptHeader(ctx: FarmContext): string {
  return [
    'You are a farm-planning assistant for a small-plot vegetable + grain operation.',
    'Output ONLY valid JSON conforming to the requested schema. No prose, no code fences.',
    `Farm location: ${ctx.latLon.lat.toFixed(2)}, ${ctx.latLon.lon.toFixed(2)}.`,
    `Last spring frost: ${new Date(ctx.lastFrostMs).toISOString().slice(0, 10)}; first fall frost: ${new Date(ctx.firstFrostMs).toISOString().slice(0, 10)}.`,
    'Shade rule: a tall (shade=Y) crop in column E casts morning shadow on E-1 and afternoon shadow on E+1, only when same N-idx ±1.',
    'Rotation rule: brassica/allium 3y, solanaceae 4y, cucurbit 2y, legume/corn 1y. Cover crops + perennials are exempt.'
  ].join('\n');
}

/** Phase 17 (Track 3.2) — bulky data dump. The block & crop catalog are
 *  the largest part of the system prompt. Splitting them into their own
 *  cached block means even when the header is varied (e.g., a new
 *  endpoint adds task-specific framing), this block stays cached. */
function buildFarmSystemPromptCatalog(ctx: FarmContext): string {
  return [
    `Blocks (id | label | E-idx | N-idx | acres | sun): ${ctx.blocks
      .map(
        (b) =>
          `${b.id}|${b.label}|${b.eastWestIndex ?? '-'}|${b.northSouthIndex ?? '-'}|${b.acres ?? '-'}|${b.sunExposure ?? 'full'}`
      )
      .join('; ')}`,
    `Crop catalog (pluginId | family | dtmMin | dtmMax | shade | heightFt): ${ctx.cropCatalog
      .map(
        (c) =>
          `${c.pluginId}|${c.family}|${c.dtmMin ?? '-'}|${c.dtmMax ?? '-'}|${c.shadeCasting ? 'Y' : 'N'}|${c.matureHeightFt ?? '-'}`
      )
      .join('; ')}`
  ].join('\n');
}

/** Back-compat — single-string builder kept for callers that haven't
 *  migrated to the dual-block system. New callers should use
 *  `buildFarmSystemBlocks` to take advantage of the second cache breakpoint. */
export function buildFarmSystemPrompt(ctx: FarmContext): string {
  return `${buildFarmSystemPromptHeader(ctx)}\n${buildFarmSystemPromptCatalog(ctx)}`;
}

/** Phase 17 (Track 3.2) — emit two system blocks, each with its own
 *  ephemeral cache breakpoint. Anthropic supports up to 4 breakpoints
 *  per request; we use 2 here, leaving 2 free for downstream endpoints
 *  that want to cache additional task-specific instruction blocks. */
export function buildFarmSystemBlocks(
  ctx: FarmContext
): Array<{ type: 'text'; text: string; cache_control: { type: 'ephemeral' } }> {
  return [
    {
      type: 'text' as const,
      text: buildFarmSystemPromptHeader(ctx),
      cache_control: { type: 'ephemeral' as const }
    },
    {
      type: 'text' as const,
      text: buildFarmSystemPromptCatalog(ctx),
      cache_control: { type: 'ephemeral' as const }
    }
  ];
}

export interface AiResultMeta {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  usdEstimate: number;
}

export function estimateUsd(meta: Omit<AiResultMeta, 'usdEstimate'>, choice: ModelChoice): number {
  const { inputTokens, cachedInputTokens, outputTokens } = meta;
  return (
    (cachedInputTokens / 1_000_000) * choice.pricing.cachedInputUsdPerMTok +
    (inputTokens / 1_000_000) * choice.pricing.inputUsdPerMTok +
    (outputTokens / 1_000_000) * choice.pricing.outputUsdPerMTok
  );
}

export interface PlanSuggestion {
  blockId: string;
  cropPluginId: string;
  /** ISO date (YYYY-MM-DD); the server snaps to settings boundaries before persisting. */
  plantingDate: string;
  rationaleShort?: string;
}

export interface PlanResponse {
  suggestions: PlanSuggestion[];
  meta: AiResultMeta;
}

const MAX_TOKENS_BY_TASK: Record<AiTask, number> = {
  suggest: 300,
  succession: 300,
  optimize: 2500,
  rationale: 600,
  allocate: 4000,
  groups: 4000,
  shortNames: 1500,
  inputs: 3000
};

export interface PlanWithAIOptions {
  /** Phase 17 (Track 3.4) — when threading is enabled and a session id
   *  is supplied, prior turns from the same session are echoed into the
   *  message history. */
  planningSessionId?: string;
  /** Phase 17 (Track 3.5) — caller passes through whether the farm
   *  context was a cache hit, for telemetry attribution. */
  contextCacheHit?: boolean;
  /** Phase 17 (Track 3.5) — caller passes through whether at least one
   *  derived signal was reused. */
  derivedSignalHit?: boolean;
}

export async function planWithAI(
  task: AiTask,
  ctx: FarmContext,
  userPrompt: string,
  options: PlanWithAIOptions = {}
): Promise<PlanResponse> {
  const choice = selectModel(task);
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No Anthropic API key configured. Add it on the Settings page.');
  const client = new Anthropic({ apiKey });

  // Phase 17 (Track 3.2) — dual cache breakpoints (header + bulky catalog).
  const systemBlocks = buildFarmSystemBlocks(ctx);

  // Phase 17 (Track 3.4) — optional cross-endpoint conversation threading.
  const messages = buildThreadedMessages(options.planningSessionId, userPrompt).map((m) => ({
    role: m.role,
    content: [{ type: 'text' as const, text: m.content }]
  }));

  const startMs = Date.now();
  const msg = await client.messages.create({
    model: choice.model,
    max_tokens: MAX_TOKENS_BY_TASK[task],
    system: systemBlocks,
    messages
  });
  const durationMs = Date.now() - startMs;

  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  let suggestions: PlanSuggestion[] = [];
  try {
    // Strip code fences if the model added them despite instructions.
    const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    const parsed = JSON.parse(stripped) as { suggestions?: PlanSuggestion[] };
    if (Array.isArray(parsed.suggestions)) suggestions = parsed.suggestions;
  } catch {
    // fall through; meta still returned so the caller can log / refund
  }

  // Anthropic's usage block carries cache fields when caching is active.
  const usage = msg.usage as {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
  const inputTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const cachedInputTokens = usage.cache_read_input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const meta: AiResultMeta = {
    model: choice.model,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    usdEstimate: 0
  };
  meta.usdEstimate = estimateUsd(meta, choice);

  // Phase 17 (Track 3.4) — append this turn to the planning session so
  // the next call sees it in the threaded message history.
  if (options.planningSessionId) {
    appendTurn(options.planningSessionId, {
      endpoint:
        task === 'allocate' || task === 'groups' || task === 'optimize' || task === 'suggest'
          ? task
          : 'suggest',
      userPrompt,
      assistantResponse: text,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      occurredAt: Date.now()
    });
  }

  // Phase 17 (Track 3.5) — record per-call telemetry.
  recordAiCall({
    endpoint: 'planWithAI',
    model: choice.model,
    contextCacheHit: !!options.contextCacheHit,
    derivedSignalHit: !!options.derivedSignalHit,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    usdEstimate: meta.usdEstimate,
    durationMs,
    planningSessionId: options.planningSessionId
  });

  return { suggestions, meta };
}
