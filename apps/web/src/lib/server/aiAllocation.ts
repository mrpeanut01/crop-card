/**
 * AI seed allocation (Phase 14e — UC-37).
 *
 * The deterministic engine pre-computes a candidacy matrix — for every
 * (seed, block) pair: how many plants fit, sufficiency status, sun match,
 * rotation window, companion conflicts, narrow-block flag — and Claude
 * picks the actual placements from that grid. This keeps the AI's job
 * tractable (no math), grounded (it cannot place a seed where capacity
 * is zero), and cheap (~3-4k input tokens with prompt caching).
 *
 * AI output is validated against the same rules used to build the matrix.
 * On invalid plan we retry once with `Violations: ...` prepended; on
 * second failure we fall back to the deterministic `planLayout()` and
 * flag the response so the UI can warn the user.
 */

import Anthropic from '@anthropic-ai/sdk';
import { anthropicClient } from './anthropicClient';
import type { CompanionPlugin, CropPlugin } from '$lib/plugins/schemas';
import type { BlockWithPlantings } from '$lib/db/blocks';
import type { Crop } from '$lib/db/crops';
import { planLayout, type PlanInput, type SeedRequest, type Assignment } from '$lib/layout/engine';
import {
  blocksWithRoomForLeftover,
  cropsOnBlock,
  crossingCrop,
  isNarrow,
  keepApartCrops,
  leftoverReports,
  rotationConflict,
  sunMatchOf,
  type LeftoverReport
} from '$lib/layout/split';
import {
  plantsFitUsable,
  sufficiencyOf,
  usableSqft,
  type SufficiencyResult
} from '$lib/layout/sufficiency';
import {
  BED_SHARE_CAP,
  bedPlantsFit,
  bedUsableSqft,
  freeBedShare,
  plantsForShare,
  SHARE_EPSILON
} from '$lib/layout/bedSharing';
import {
  buildFarmSystemBlocks,
  estimateUsd,
  selectModel,
  type AiResultMeta,
  type FarmContext
} from './aiPlanning';
import { recordAiCall } from './aiCallStats';
import { contentKey, getDerivedSignal, setDerivedSignal } from './aiDerivedSignals';
import { appendTurn, buildThreadedMessages } from './aiPlanningSession';
import { getApiKey } from './scanResult';
import {
  buildPollinationLayer,
  computePollinationConstraints,
  renderPollinationPromptSection,
  type PollinationLayer
} from '$lib/plan/pollinationLayer';
import { detectCompanionGroups } from '$lib/plan/companionOffsets';
import { isAreaCrop } from '$lib/plan/spacingModel';
import { t } from '$lib/i18n';
import { intlLocale } from '$lib/prefs';
import { numberToLocaleString } from '$lib/intlCache';
import type { CompanionGroupMarker, PollinationConstraint } from '$lib/plan/types';

const MAX_OUTPUT_TOKENS = 4000;

export interface MatrixRow {
  stockItemId: string;
  cropPluginId: string;
  blockId: string;
  /** Plants the block can fit at this crop's spacing, accounting for the
   *  perimeter buffer + any existing plantings on the block. */
  plantsFit: number;
  /** Plants implied by the seed quantity the farmer has on hand. */
  plantsAvailable: number;
  sufficiency: SufficiencyResult['status'];
  utilizationPct: number;
  /** #690: `unknown` when the block's sun was never recorded. */
  sunMatch: 'full' | 'partial' | 'none' | 'unknown';
  rotationOk: boolean;
  companionGoodHere: string[];
  companionBadHere: string[];
  narrowBlock: boolean;
  threeSistersCandidate: boolean;
  usableSqft: number;
  /** #440 — the block is a garden or greenhouse bed shared by area. */
  sharedBed: boolean;
  /** Plants of this crop that fill the whole block (bed math on shared
   *  beds), before existing plantings. */
  fullFit: number;
  /** Share of the block still free (1 on field blocks). */
  freeShare: number;
}

export interface AiAssignment {
  stockItemId: string;
  blockId: string;
  plants: number;
  /** #440 — fraction of a shared bed (0-1). On a shared bed it sets plants:
   *  floor(areaShare × the crop's whole-bed fit). */
  areaShare?: number;
  rationale: string;
}

export interface AllocationResult {
  assignments: Assignment[];
  unplaced: SeedRequest[];
  /** Phase 35 (C-1): why each counted lot with plants left could not go on
   *  any picked block. */
  leftover: LeftoverReport[];
  /** Per-assignment sufficiency for the UI. Indexed by `${stockItemId}:${blockId}`. */
  sufficiency: Record<string, SufficiencyResult>;
  /** Plain-language explanation for the whole plan + per-row rationale
   *  the AI returned. Empty when the engine fallback was used. */
  rationale: string;
  perRowRationale: Record<string, string>;
  /** Optional advisories — observations Claude (or the engine fallback)
   *  thinks the farmer might want to reconsider but the engine cannot
   *  enforce: oversized/undersized blocks, suggestions to co-plant, missed
   *  rotation opportunities, etc. Each entry is one plain-English sentence.
   *  May be empty when nothing notable came up. */
  advisories: string[];
  /** Phase 19 — cross-pollination constraints derived from the picked
   *  assignments. Open (`must-stagger`) entries are carried forward into
   *  the scheduler so it can pick planting dates that satisfy them. */
  pollinationConstraints: PollinationConstraint[];
  /** Block IDs whose geometry was missing — surfaced once as a banner. */
  geometryMissingBlockIds: string[];
  /** Phase 20 (B6) — companion groupings (three-sisters etc.) detected
   *  from the finalized layout. Scheduler anchors planting dates on the
   *  group's anchor and offsets companion members. Empty when no
   *  companion system matched. */
  companionGroups: CompanionGroupMarker[];
  meta: AiResultMeta & {
    /** When the AI failed twice, no API key was present, or the guard
     *  short-circuited (cap/quota), the engine's deterministic plan is
     *  returned and this is set. Invariant 7 ("AI assists, never gates")
     *  requires every degradation path to land here, not on a 4xx. */
    fallback?: 'engine-only' | 'no-api-key' | 'over-cap' | 'quota-exceeded' | 'ai-unavailable';
    violationsOnFirstAttempt?: string[];
    /** When fallback fires due to validator rejection, this carries the
     *  AI's last (invalid) proposal so the wizard can offer an
     *  "Apply anyway" override. The operator accepts agronomic risk
     *  explicitly; spray-time safety still gates the kernel later. */
    rejectedAssignments?: Array<{
      stockItemId: string;
      cropPluginId: string;
      varietyDisplayName: string;
      blockId: string;
      plants: number;
    }>;
    rejectedRationale?: string;
  };
}

export interface AllocateOptions {
  /** Phase 17 (Track 3.4) — when supplied, the Anthropic call threads prior
   *  planning-session turns and the response is appended back for downstream
   *  endpoints to see. */
  planningSessionId?: string;
  /** Phase 17 (Track 3.5) — pass-through from the caller's farm-context
   *  cache lookup; used only for telemetry attribution. */
  contextCacheHit?: boolean;
  /** Phase 17 (Track 3.3) — stable hash of the farm state. Required for the
   *  derived-signal cache; when omitted, the candidacy matrix is recomputed
   *  every call (legacy behaviour). */
  contextVersion?: string;
  /** The app language for the deterministic engine's own sentences
   *  (rationale, reasons, advisories). English without one. */
  locale?: string | null;
  /** Phase 20 (B6) — companion-system plugins (e.g., three-sisters) from
   *  the registry. When supplied, the allocator detects groupings present
   *  in the finalized assignments and emits `companionGroups[]` in the
   *  result so the scheduler can anchor + offset planting dates. */
  companionSystems?: ReadonlyArray<CompanionPlugin>;
  /** Refine only: set when aiTry() degraded (quota, cap, timeout, upstream
   *  error) so the previous plan is echoed with this message as the reply. */
  degradeMessage?: string;
}

// ─── Public API ──────────────────────────────────────────────────────────

export async function allocate(
  input: PlanInput,
  ctx: FarmContext,
  options: AllocateOptions = {}
): Promise<AllocationResult> {
  // Phase 17 (Track 3.3) — reuse the candidacy matrix across endpoints that
  // share the same farm + seed/block selection. The subKey hashes the
  // inputs that AREN'T part of the farm context so a different seed list
  // doesn't collide with an earlier allocation call.
  const matrixSubKey = hashInputsForMatrix(input);
  let derivedSignalHit = false;
  let matrix: MatrixRow[];
  if (options.contextVersion) {
    const cached = getDerivedSignal<MatrixRow[]>(
      options.contextVersion,
      'candidacy-matrix',
      matrixSubKey
    );
    if (cached) {
      matrix = cached;
      derivedSignalHit = true;
    } else {
      matrix = buildCandidacyMatrix(input);
      setDerivedSignal(options.contextVersion, 'candidacy-matrix', matrix, matrixSubKey);
    }
  } else {
    matrix = buildCandidacyMatrix(input);
  }

  const apiKey = getApiKey();
  // #210 — keep both wizard endpoints' key-resolution paths observable so a
  // divergence between allocate-uses-AI / schedule-falls-back can be
  // diagnosed from production logs without a debugger. Cheap; runs only when
  // a wizard request lands.
  console.log(
    `[ai-allocate] apiKey present=${!!apiKey} envKey=${!!process.env.ANTHROPIC_API_KEY} settingsKey=${!!(apiKey && !process.env.ANTHROPIC_API_KEY)}`
  );
  if (!apiKey) {
    return engineFallback(input, matrix, 'no-api-key', undefined, options.locale);
  }

  const choice = selectModel('allocate');
  const client = anthropicClient(apiKey);
  // Phase 17 (Track 3.2) — dual cache breakpoints (header + bulky catalog).
  const systemBlocks = buildFarmSystemBlocks(ctx);

  // Phase 19 — cross-pollination layer. Skipped when no crossing pairs are
  // in the selection; otherwise appended to the prompt so Claude can prefer
  // spatially-isolated block pairings up to the plugin's isolation ceiling.
  const pollinationLayer = buildPollinationLayer(input);
  const firstPrompt = buildAllocationPrompt(matrix, input, pollinationLayer);
  const telemetry: TelemetryConfig = {
    planningSessionId: options.planningSessionId,
    contextCacheHit: !!options.contextCacheHit,
    derivedSignalHit
  };

  let aiPlan: { assignments: AiAssignment[]; rationale: string; advisories: string[] } | null =
    null;
  let totalMeta: AiResultMeta = {
    model: choice.model,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    usdEstimate: 0
  };
  let violationsOnFirstAttempt: string[] | undefined;

  try {
    const first = await callClaude(client, choice.model, systemBlocks, firstPrompt, telemetry);
    addMeta(totalMeta, first.meta);
    const firstResponseText = stringifyForRetry(first.parsed);
    const validation = validateAiPlan(first.parsed, input, matrix);
    if (validation.valid) {
      aiPlan = validation.plan;
    } else {
      violationsOnFirstAttempt = validation.violations;
      // Phase 15e — multi-turn retry: send the original prompt + the prior
      // assistant response + a focused correction message. Lets Claude
      // amend its bad answer surgically rather than re-derive from scratch.
      // Cached system prompt stays cached; only the assistant echo + new
      // correction text add input tokens. Helps a lot for semantic
      // violations like "exceeded plantsFit" or "surplus > 1.25× cap".
      const retry = await retryWithSemanticContext(
        client,
        choice.model,
        systemBlocks,
        firstPrompt,
        firstResponseText,
        validation.violations,
        telemetry
      );
      addMeta(totalMeta, retry.meta);
      const retryValidation = validateAiPlan(retry.parsed, input, matrix);
      if (retryValidation.valid) {
        aiPlan = retryValidation.plan;
      }
    }
  } catch {
    // Fall through to engine-only path.
  }

  if (!aiPlan) {
    const fallback = engineFallback(input, matrix, 'engine-only', undefined, options.locale);
    fallback.pollinationConstraints = computePollinationConstraints(
      fallback.assignments,
      input,
      pollinationLayer
    );
    fallback.geometryMissingBlockIds = pollinationLayer.geometryMissingBlockIds;
    fallback.meta = {
      ...fallback.meta,
      ...totalMeta,
      usdEstimate: totalMeta.usdEstimate,
      fallback: 'engine-only',
      violationsOnFirstAttempt
    };
    return fallback;
  }

  const assignments: Assignment[] = aiPlan.assignments.map((a) => {
    const seed = input.seeds.find((s) => s.stockItemId === a.stockItemId)!;
    return {
      stockItemId: a.stockItemId,
      cropPluginId: seed.cropPluginId,
      varietyDisplayName: seed.varietyDisplayName,
      blockId: a.blockId,
      plants: a.plants,
      score: 0
    };
  });

  const unplaced = computeUnplaced(input.seeds, assignments);
  const sufficiency = computeSufficiencyByPair(assignments, input);
  const perRowRationale: Record<string, string> = {};
  for (const a of aiPlan.assignments) {
    perRowRationale[`${a.stockItemId}:${a.blockId}`] = a.rationale;
  }

  return {
    assignments,
    unplaced,
    leftover: leftoverReports(input, assignments),
    sufficiency,
    rationale: aiPlan.rationale,
    perRowRationale,
    pollinationConstraints: computePollinationConstraints(assignments, input, pollinationLayer),
    geometryMissingBlockIds: pollinationLayer.geometryMissingBlockIds,
    companionGroups: detectGroupsForAssignments(assignments, input, options.companionSystems),
    advisories: aiPlan.advisories,
    meta: { ...totalMeta, violationsOnFirstAttempt }
  };
}

function detectGroupsForAssignments(
  assignments: ReadonlyArray<Assignment>,
  input: PlanInput,
  systems: ReadonlyArray<CompanionPlugin> | undefined
): CompanionGroupMarker[] {
  if (!systems || systems.length === 0) return [];
  return detectCompanionGroups(
    assignments.map((a) => ({
      stockItemId: a.stockItemId,
      blockId: a.blockId,
      cropPluginId: a.cropPluginId
    })),
    input.pluginIndex,
    systems
  );
}

// ─── Chat refinement (review-step "talk to the planner") ────────────────

export interface AllocationChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface RefineInput {
  /** The plan currently displayed to the farmer. Becomes the assistant's
   *  echoed opening so Claude knows what state we're amending. */
  previousAssignments: Array<{
    stockItemId: string;
    blockId: string;
    plants: number;
    rationale: string;
  }>;
  previousRationale: string;
  previousAdvisories: string[];
  /** Prior chat turns since the initial allocation. Last entry MUST be the
   *  user's new message; the server uses everything before it as the
   *  alternating user/assistant tail. */
  transcript: AllocationChatTurn[];
}

export interface RefineResult extends AllocationResult {
  /** Plain-English chat-bubble text from the assistant for this turn. */
  reply: string;
}

const MAX_CHAT_TURNS = 30;

export async function refineAllocation(
  input: PlanInput,
  ctx: FarmContext,
  refine: RefineInput,
  options: AllocateOptions = {}
): Promise<RefineResult> {
  const matrixSubKey = hashInputsForMatrix(input);
  let derivedSignalHit = false;
  let matrix: MatrixRow[];
  if (options.contextVersion) {
    const cached = getDerivedSignal<MatrixRow[]>(
      options.contextVersion,
      'candidacy-matrix',
      matrixSubKey
    );
    if (cached) {
      matrix = cached;
      derivedSignalHit = true;
    } else {
      matrix = buildCandidacyMatrix(input);
      setDerivedSignal(options.contextVersion, 'candidacy-matrix', matrix, matrixSubKey);
    }
  } else {
    matrix = buildCandidacyMatrix(input);
  }

  if (
    refine.transcript.length === 0 ||
    refine.transcript[refine.transcript.length - 1].role !== 'user'
  ) {
    throw new Error('refine transcript must end with a user message');
  }
  if (refine.transcript.length > MAX_CHAT_TURNS) {
    throw new Error(`refine transcript exceeds ${MAX_CHAT_TURNS} turns`);
  }

  const apiKey = getApiKey();
  if (!apiKey || options.degradeMessage) {
    return {
      ...echoPreviousPlan(input, matrix, refine),
      reply: options.degradeMessage
        ? `${options.degradeMessage} The current plan is unchanged.`
        : "I can't refine the plan without an Anthropic API key — add one on the Settings page and the chat will come back. The current plan is unchanged."
    };
  }

  const choice = selectModel('allocate');
  const client = anthropicClient(apiKey);
  const systemBlocks = buildFarmSystemBlocks(ctx);
  const pollinationLayer = buildPollinationLayer(input);
  const matrixPrompt = buildAllocationPrompt(matrix, input, pollinationLayer);

  // The "initial assistant turn" is the plan that was already shown to the
  // farmer. We stringify it so Claude grounds revisions on the same state
  // the operator sees on screen — no drift between table and chat.
  const initialAssistantJson = JSON.stringify(
    {
      rationale: refine.previousRationale,
      assignments: refine.previousAssignments,
      advisories: refine.previousAdvisories
    },
    null,
    2
  );

  const messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string }[] }> =
    [
      { role: 'user', content: [{ type: 'text', text: matrixPrompt }] },
      { role: 'assistant', content: [{ type: 'text', text: initialAssistantJson }] }
    ];

  // Mid-conversation turns (everything except the new user message at tail).
  const priorChat = refine.transcript.slice(0, -1);
  for (const t of priorChat) {
    messages.push({
      role: t.role,
      content: [{ type: 'text', text: t.content }]
    });
  }
  const newUserMessage = refine.transcript[refine.transcript.length - 1].content;
  messages.push({
    role: 'user',
    content: [{ type: 'text', text: buildRefinementUserMessage(newUserMessage) }]
  });

  const telemetry: TelemetryConfig = {
    planningSessionId: options.planningSessionId,
    contextCacheHit: !!options.contextCacheHit,
    derivedSignalHit
  };

  let parsed: unknown;
  let totalMeta: AiResultMeta = {
    model: choice.model,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    usdEstimate: 0
  };
  let rawText: string;
  try {
    const startMs = Date.now();
    const msg = await client.messages.create({
      model: choice.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemBlocks,
      messages
    });
    const durationMs = Date.now() - startMs;
    rawText = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
    const stripped = rawText.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    try {
      parsed = JSON.parse(stripped);
    } catch {
      parsed = null;
    }
    const meta = computeMeta(msg.usage, choice.model);
    recordAllocateTelemetry(meta, durationMs, telemetry);
    appendAllocateTurn(telemetry.planningSessionId, newUserMessage, rawText, meta);
    addMeta(totalMeta, meta);
  } catch {
    return {
      ...echoPreviousPlan(input, matrix, refine),
      reply:
        'The AI request failed — the current plan is unchanged. Try again, or use the Regenerate button to start over.'
    };
  }

  const refinement = parseRefinementResponse(parsed);
  if (!refinement) {
    return {
      ...echoPreviousPlan(input, matrix, refine),
      reply:
        "I couldn't read the AI response cleanly — the current plan is unchanged. Try rephrasing your request.",
      meta: { ...totalMeta, fallback: 'engine-only' }
    };
  }

  const previousTotals = new Map<string, number>();
  for (const a of refine.previousAssignments) {
    previousTotals.set(a.stockItemId, (previousTotals.get(a.stockItemId) ?? 0) + a.plants);
  }
  let validation = validateAiPlan(
    {
      assignments: refinement.assignments,
      rationale: refinement.rationale,
      advisories: refinement.advisories
    },
    input,
    matrix,
    { previousTotals }
  );
  let lastRefinement = refinement;

  // ─── Corrective retry — same pattern as refineSchedule + initial
  //     scheduler. Echo the rejected plan + violation list, ask Claude
  //     to patch the broken constraints surgically. ──────────────────
  if (!validation.valid) {
    console.warn(
      `[aiAllocation.refine] first attempt failed validation (${validation.violations.length} violations); retrying.\n` +
        `Violations: ${validation.violations.slice(0, 6).join(' | ')}`
    );
    const correction =
      'Your previous response was rejected by the validator. Violations:\n' +
      validation.violations.map((v) => `- ${v}`).join('\n') +
      '\n\nReturn a CORRECTED allocation that fixes EVERY violation:' +
      '\n- Every (stockItemId, blockId) pair MUST appear in the candidacy matrix from the first message.' +
      '\n- Respect plantsFit caps; do not over-fill a block.' +
      '\n- Honor sun, rotation, narrow, companion-bad, and pollination flags from the matrix.' +
      '\n- Spread a seed over the picked blocks before leaving any of it unplaced, and keep a seed marked keep_in_one_bed=Y on one block.' +
      '\n\nSame JSON shape as before — no prose, no code fences.';
    try {
      const retryMsgs = [
        ...messages,
        { role: 'assistant' as const, content: [{ type: 'text' as const, text: rawText }] },
        { role: 'user' as const, content: [{ type: 'text' as const, text: correction }] }
      ];
      const retryStart = Date.now();
      const retryResp = await client.messages.create({
        model: choice.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: systemBlocks,
        messages: retryMsgs
      });
      const retryDuration = Date.now() - retryStart;
      const retryText = retryResp.content[0]?.type === 'text' ? retryResp.content[0].text : '';
      let retryParsed: unknown = null;
      try {
        retryParsed = JSON.parse(retryText.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
      } catch {
        retryParsed = null;
      }
      const retryMeta = computeMeta(retryResp.usage, choice.model);
      recordAllocateTelemetry(retryMeta, retryDuration, telemetry);
      addMeta(totalMeta, retryMeta);
      const retryRefinement = parseRefinementResponse(retryParsed);
      if (retryRefinement) {
        const retryValidation = validateAiPlan(
          {
            assignments: retryRefinement.assignments,
            rationale: retryRefinement.rationale,
            advisories: retryRefinement.advisories
          },
          input,
          matrix,
          { previousTotals }
        );
        if (retryValidation.valid) {
          validation = retryValidation;
          lastRefinement = retryRefinement;
        } else {
          console.warn(
            `[aiAllocation.refine] retry ALSO failed (${retryValidation.violations.length} violations).`
          );
          validation = retryValidation;
        }
      }
    } catch (err) {
      console.warn(
        '[aiAllocation.refine] retry Anthropic call failed:',
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  // #208 / CT-PP-008 — substitution-only invariant. The AI MAY change
  // which seed lands in which block, but it MUST NOT drop assignments
  // from the prior plan. When it does (typically by responding "I can't
  // do that" with a reduced JSON listing only the seeds it commented
  // on), the wizard would otherwise silently shrink the table from N
  // rows to a handful — partial-commit data loss. Echo the prior plan
  // back with a clear message instead.
  // Spec: CLAUDE.md Phase 21b B-27, AI_PROVENANCE_ADDENDUM §substitution-only.
  if (validation.valid) {
    const priorKeys = new Set(
      refine.previousAssignments.map((a) => `${a.stockItemId}|${a.blockId}`)
    );
    const refinedKeys = new Set(
      validation.plan.assignments.map((a) => `${a.stockItemId}|${a.blockId}`)
    );
    const droppedKeys: string[] = [];
    for (const key of priorKeys) {
      if (!refinedKeys.has(key)) droppedKeys.push(key);
    }
    if (droppedKeys.length > 0) {
      console.warn(
        `[aiAllocation.refine] substitution-only violation: AI dropped ${droppedKeys.length} prior assignment(s); preserving prior plan.`
      );
      return {
        ...echoPreviousPlan(input, matrix, refine),
        reply:
          lastRefinement.reply ||
          `That change would have dropped ${droppedKeys.length} planting${droppedKeys.length === 1 ? '' : 's'} from the plan. Refinement is substitution-only — the current plan is unchanged. Try a more targeted request (e.g. "swap A for B in block X").`,
        meta: {
          ...totalMeta,
          fallback: 'engine-only',
          violationsOnFirstAttempt: [`substitution-only: ${droppedKeys.length} dropped`]
        }
      };
    }
  }

  if (!validation.valid) {
    // Capture the AI's last proposal so the wizard can offer
    // "Apply anyway" — operator overrides agronomic validators when
    // they know better. Stock metadata fills in cropPluginId +
    // varietyDisplayName; if the AI invented a (seed, block) pair
    // outside the matrix, the seed lookup may miss — we skip that
    // assignment so the override doesn't propagate bogus rows.
    const rejectedAssignments = lastRefinement.assignments
      .map((a) => {
        const seed = input.seeds.find((s) => s.stockItemId === a.stockItemId);
        if (!seed) return null;
        const row = matrix.find((r) => r.stockItemId === a.stockItemId && r.blockId === a.blockId);
        const plants =
          a.plants > 0
            ? a.plants
            : row && a.areaShare !== undefined
              ? plantsForShare(a.areaShare, row.fullFit)
              : 0;
        return {
          stockItemId: a.stockItemId,
          cropPluginId: seed.cropPluginId,
          varietyDisplayName: seed.varietyDisplayName,
          blockId: a.blockId,
          plants: Math.max(1, Math.floor(plants))
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    return {
      ...echoPreviousPlan(input, matrix, refine),
      reply:
        lastRefinement.reply ||
        'I tried to apply that change but it would break the block constraints (size, sun, rotation, or companions). The current plan is unchanged.',
      meta: {
        ...totalMeta,
        fallback: 'engine-only',
        violationsOnFirstAttempt: validation.violations,
        rejectedAssignments,
        rejectedRationale: lastRefinement.rationale
      }
    };
  }

  const assignments: Assignment[] = validation.plan.assignments.map((a) => {
    const seed = input.seeds.find((s) => s.stockItemId === a.stockItemId)!;
    return {
      stockItemId: a.stockItemId,
      cropPluginId: seed.cropPluginId,
      varietyDisplayName: seed.varietyDisplayName,
      blockId: a.blockId,
      plants: a.plants,
      score: 0
    };
  });

  const unplaced = computeUnplaced(input.seeds, assignments);
  const sufficiency = computeSufficiencyByPair(assignments, input);
  const perRowRationale: Record<string, string> = {};
  for (const a of validation.plan.assignments) {
    perRowRationale[`${a.stockItemId}:${a.blockId}`] = a.rationale;
  }

  return {
    assignments,
    unplaced,
    leftover: leftoverReports(input, assignments),
    sufficiency,
    rationale: validation.plan.rationale || refine.previousRationale,
    perRowRationale,
    advisories: validation.plan.advisories,
    pollinationConstraints: computePollinationConstraints(assignments, input, pollinationLayer),
    geometryMissingBlockIds: pollinationLayer.geometryMissingBlockIds,
    companionGroups: detectGroupsForAssignments(assignments, input, options.companionSystems),
    reply: refinement.reply || 'Done — updated the plan above.',
    meta: totalMeta
  };
}

function buildRefinementUserMessage(message: string): string {
  return [
    'REFINEMENT TURN — the farmer is reviewing the plan and has new feedback.',
    '',
    'The candidacy matrix from the very first message in this conversation still defines what is feasible. Every constraint there (plantsFit, sufficiency, sunMatch, rotationOk, compBad, narrow, density caps) applies to your revised assignments. Do NOT invent (seed, block) pairs that are not in the matrix.',
    '',
    'Respond with VALID JSON only — no markdown, no code fences, no commentary outside the JSON:',
    '{',
    '  "reply": "1-3 plain-English sentences shown directly in the chat. Acknowledge what the farmer asked for and explain what you changed (or why you couldn\'t change it). Never quote column names like sufficiency, sunMatch, plantsFit, etc.",',
    '  "rationale": "2-4 sentence updated overview of the whole plan. If nothing material changed, repeat the previous overview.",',
    '  "assignments": [',
    '    { "stockItemId": "...", "blockId": "...", "plants": <int>, "areaShare": <number 0-1, shared beds only>, "rationale": "1 plain-English sentence" }',
    '  ],',
    '  "advisories": ["0-4 short observations the farmer might want to consider — empty array is fine"]',
    '}',
    '',
    'Hard rules:',
    '- Always return the COMPLETE revised assignments array (not a diff). Include every row that should remain, even if unchanged.',
    '- If the request would violate a hard cap (exceed plantsFit, place on a bad-companion block, exceed density caps, etc.), KEEP the previous assignments unchanged, set "reply" to a clear plain-English explanation of why it can\'t be done, and put a brief note in "advisories".',
    '- If the request is unclear, ask for clarification in "reply" and keep the previous assignments unchanged.',
    '- Never echo raw matrix values, column names, or JSON into "reply".',
    '',
    `Farmer's message: ${message}`
  ].join('\n');
}

interface RefinementResponse {
  reply: string;
  rationale: string;
  assignments: AiAssignment[];
  advisories: string[];
}

function parseRefinementResponse(raw: unknown): RefinementResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as {
    reply?: unknown;
    rationale?: unknown;
    assignments?: unknown;
    advisories?: unknown;
  };
  const reply = typeof r.reply === 'string' ? r.reply.trim() : '';
  const rationale = typeof r.rationale === 'string' ? r.rationale : '';
  if (!Array.isArray(r.assignments)) return null;
  const assignments: AiAssignment[] = [];
  for (const a of r.assignments) {
    if (!a || typeof a !== 'object') continue;
    const item = a as Partial<AiAssignment>;
    const hasPlants =
      typeof item.plants === 'number' && Number.isFinite(item.plants) && item.plants > 0;
    const hasShare =
      typeof item.areaShare === 'number' && Number.isFinite(item.areaShare) && item.areaShare > 0;
    if (typeof item.stockItemId !== 'string' || typeof item.blockId !== 'string') continue;
    if (!hasPlants && !hasShare) continue;
    assignments.push({
      stockItemId: item.stockItemId,
      blockId: item.blockId,
      plants: hasPlants ? Math.floor(item.plants as number) : 0,
      ...(hasShare ? { areaShare: item.areaShare } : {}),
      rationale: typeof item.rationale === 'string' ? item.rationale : ''
    });
  }
  const advisories = Array.isArray(r.advisories)
    ? r.advisories
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
        .slice(0, 6)
    : [];
  return { reply, rationale, assignments, advisories };
}

/** When refinement can't be applied (no API key, invalid response, etc.) we
 *  hand the previous plan back unchanged so the table stays in sync with
 *  what the operator was already looking at. */
function echoPreviousPlan(
  input: PlanInput,
  matrix: MatrixRow[],
  refine: RefineInput
): AllocationResult {
  const assignments: Assignment[] = refine.previousAssignments.map((a) => {
    const seed = input.seeds.find((s) => s.stockItemId === a.stockItemId);
    const cropPluginId = seed?.cropPluginId ?? '';
    const varietyDisplayName = seed?.varietyDisplayName ?? '';
    return {
      stockItemId: a.stockItemId,
      cropPluginId,
      varietyDisplayName,
      blockId: a.blockId,
      plants: Math.max(1, Math.floor(a.plants)),
      score: 0
    };
  });
  const sufficiency = computeSufficiencyByPair(assignments, input);
  const unplaced = computeUnplaced(input.seeds, assignments);
  const perRowRationale: Record<string, string> = {};
  for (const a of refine.previousAssignments) {
    perRowRationale[`${a.stockItemId}:${a.blockId}`] = a.rationale;
  }
  void matrix;
  const layer = buildPollinationLayer(input);
  return {
    assignments,
    unplaced,
    leftover: leftoverReports(input, assignments),
    sufficiency,
    rationale: refine.previousRationale,
    perRowRationale,
    advisories: refine.previousAdvisories,
    pollinationConstraints: computePollinationConstraints(assignments, input, layer),
    geometryMissingBlockIds: layer.geometryMissingBlockIds,
    companionGroups: [],
    meta: {
      model: 'echo',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      usdEstimate: 0
    }
  };
}

// ─── Candidacy matrix ────────────────────────────────────────────────────

export function buildCandidacyMatrix(input: PlanInput): MatrixRow[] {
  const out: MatrixRow[] = [];

  const bedIds = new Set(input.bedBlockIds ?? []);
  const freeShareByBed = new Map<string, number>();
  for (const block of input.blocks) {
    if (bedIds.has(block.id)) {
      freeShareByBed.set(block.id, freeBedShare(block, input.existingCrops, input.pluginIndex));
    }
  }

  for (const seed of input.seeds) {
    const plugin = input.pluginIndex[seed.cropPluginId];
    if (!plugin) continue;
    const compEntry = input.companions[seed.cropPluginId] ?? { goodWith: [], badWith: [] };

    for (const block of input.blocks) {
      const sharedBed = bedIds.has(block.id);
      const freeShare = sharedBed ? (freeShareByBed.get(block.id) ?? 0) : 1;
      const fullFit = sharedBed ? bedPlantsFit(block, plugin) : plantsFitUsable(block, plugin);
      const plantsFit = sharedBed
        ? plantsForShare(freeShare, fullFit)
        : plantsFitUsableForBlock(block, plugin, input.existingCrops);
      const usable = sharedBed ? { sqft: bedUsableSqft(block) } : usableSqft(block);
      const sufficiency = sufficiencyOf({
        plantsAvailable: seed.quantityPlants,
        plantsFit
      });

      // Phase 35 (R-17): the same helpers the engine's rule-outs use, so
      // the prompt and the validator agree.
      const sunMatch =
        block.sunExposure == null ? 'unknown' : sunMatchOf(seed, plugin, block.sunExposure);
      const rotationOk = rotationConflict(input, plugin, block.id) === null;
      const placedHere = new Set(cropsOnBlock(input, block.id, []));
      const goodHere = compEntry.goodWith.filter((p) => placedHere.has(p));
      const badHere = keepApartCrops(input, seed.cropPluginId, block.id, []);
      const narrow = isNarrow(block, plugin, sharedBed);

      const fam = plugin.cropFamily;
      const threeSistersCandidate = fam === 'corn' || fam === 'legume' || fam === 'cucurbit';

      out.push({
        stockItemId: seed.stockItemId,
        cropPluginId: seed.cropPluginId,
        blockId: block.id,
        plantsFit,
        plantsAvailable: seed.quantityPlants,
        sufficiency: sufficiency.status,
        utilizationPct: Number(sufficiency.utilizationPct.toFixed(2)),
        sunMatch,
        rotationOk,
        companionGoodHere: goodHere,
        companionBadHere: badHere,
        narrowBlock: narrow,
        threeSistersCandidate,
        usableSqft: Math.round(usable.sqft),
        sharedBed,
        fullFit,
        freeShare: Number(freeShare.toFixed(3))
      });
    }
  }
  return out;
}

function plantsFitUsableForBlock(
  block: BlockWithPlantings,
  plugin: CropPlugin,
  existingCrops: ReadonlyArray<Crop>
): number {
  const total = plantsFitUsable(block, plugin);
  // Account for in-place existing crops eating capacity.
  let consumed = 0;
  for (const c of existingCrops) {
    if (c.blockId !== block.id) continue;
    if (c.status === 'archived' || c.status === 'failed' || c.status === 'harvested') continue;
    if (c.quantityPlanted != null) consumed += c.quantityPlanted;
    else consumed += plantsFitUsable(block, plugin) * 0.5;
  }
  return Math.max(0, total - Math.floor(consumed));
}

// ─── Prompt building ─────────────────────────────────────────────────────

export function buildAllocationPrompt(
  matrix: MatrixRow[],
  input: PlanInput,
  pollinationLayer?: PollinationLayer
): string {
  const byArea = (s: (typeof input.seeds)[number]) => {
    const plugin = input.pluginIndex[s.cropPluginId];
    return !!plugin && isAreaCrop(plugin);
  };
  const seedLines = input.seeds.map(
    (s) =>
      `- ${s.stockItemId} | ${s.varietyDisplayName} | plugin=${s.cropPluginId} | ` +
      (s.fillToCapacity
        ? `available_plants=not set (size it to the space you give it, at most ${s.quantityPlants})`
        : `available_plants=${s.quantityPlants}`) +
      (byArea(s) ? ' | sown_by_area=Y' : '') +
      (s.keepInOneBed && !s.fillToCapacity ? ' | keep_in_one_bed=Y' : '')
  );
  const areaSeeds = input.seeds.filter(byArea);
  const areaSection =
    areaSeeds.length > 0
      ? [
          '',
          'SOWN BY AREA (seeds marked sown_by_area=Y are drilled or broadcast, such as cover crops and small grains):',
          '- For these seeds every "plants" number (available_plants, plantsFit, plantsAvailable and the plants you return) is SQUARE FEET of ground, not a count of plants. Give each one ground, never a number of plants.',
          '- Never say how many plants such a crop has in the rationale; talk about the square feet it covers.'
        ]
      : [];
  const keepSeeds = input.seeds.filter((s) => s.keepInOneBed && !s.fillToCapacity);
  const bedIds = new Set(input.bedBlockIds ?? []);
  const freeShareOf = (blockId: string) =>
    matrix.find((r) => r.blockId === blockId)?.freeShare ?? 1;
  const blockLines = input.blocks.map((b) => {
    if (bedIds.has(b.id)) {
      return `- ${b.id} | ${b.blockLabel ?? b.name} | shared_bed=Y | free_share=${freeShareOf(b.id)} | sun=${b.sunExposure ?? '?'} | usable_sqft=${Math.round(bedUsableSqft(b))}`;
    }
    const usable = usableSqft(b);
    return `- ${b.id} | ${b.blockLabel ?? b.name} | acres=${b.acres ?? '?'} | sun=${b.sunExposure ?? '?'} | usable_sqft=${Math.round(usable.sqft)}`;
  });
  const hasSharedBeds = input.blocks.some((b) => bedIds.has(b.id));
  const sharedBedSection = hasSharedBeds
    ? [
        '',
        'SHARED BEDS (blocks marked shared_bed=Y are garden or greenhouse beds):',
        '- Crops on one shared bed split its AREA. For each assignment on a shared bed, return "areaShare": the fraction of the whole bed that crop gets (for example 0.25 for a quarter of the bed).',
        "- The areaShare values of every crop on one shared bed must add up to no more than that bed's free_share. Never give two crops the whole bed.",
        '- Plants are worked out for you as areaShare × that crop\'s whole-bed plantsFit, so you may leave "plants" out on a shared bed.',
        "- Seed left over is fine only once every bed that suits the crop is full. Never squeeze extra plants past a bed's free_share to use it up.",
        '- Split a bed between the crops that suit it, roughly in proportion to how much of each the farmer has. A crop with available_plants "not set" should get a fair share, not the whole bed.'
      ]
    : [];

  const matrixHeader = [
    'stockItemId',
    'blockId',
    'plantsFit',
    'plantsAvailable',
    'sufficiency',
    'utilization',
    'sunMatch',
    'rotationOk',
    'compGood',
    'compBad',
    'narrow',
    'threeSisters'
  ].join(',');

  const matrixRows = matrix.map((r) =>
    [
      r.stockItemId,
      r.blockId,
      r.plantsFit,
      r.plantsAvailable,
      r.sufficiency,
      r.utilizationPct,
      r.sunMatch,
      r.rotationOk ? 'Y' : 'N',
      r.companionGoodHere.length > 0 ? r.companionGoodHere.join('|') : '-',
      r.companionBadHere.length > 0 ? r.companionBadHere.join('|') : '-',
      r.narrowBlock ? 'Y' : 'N',
      r.threeSistersCandidate ? 'Y' : 'N'
    ].join(',')
  );

  const pollinationSection =
    pollinationLayer && pollinationLayer.pairs.length > 0
      ? '\n\n' + renderPollinationPromptSection(pollinationLayer, input)
      : '';

  return (
    [
      'Allocate the following seed lots onto the given blocks.',
      '',
      'SEEDS:',
      ...seedLines,
      '',
      'BLOCKS:',
      ...blockLines,
      '',
      ...sharedBedSection,
      ...areaSection,
      '',
      'CANDIDACY MATRIX (one row per seed × block):',
      matrixHeader,
      ...matrixRows,
      '',
      'Column meanings (use these in plain English when writing rationale — NEVER quote the column names back to the user):',
      "- plantsFit = how many plants the block can physically hold at this crop's row + plant spacing",
      "- plantsAvailable = how many plants the farmer's seed quantity will produce",
      '- sufficiency: "match" = seed quantity fills the block (within ±10%); "surplus" = farmer has more seed than the block can hold (some left over); "deficit" = farmer doesn\'t have enough seed to fill the block',
      '- utilization = plantsAvailable / plantsFit (e.g. 0.55 means only 55% of the block would be planted)',
      '- sunMatch: "full" = block sun exactly matches what the crop wants; "partial" = acceptable but not ideal; "none" = wrong sun for this crop; "unknown" = the block\'s sun is not recorded (never say it is acceptable or ideal)',
      '- rotationOk: Y = no same-family crop planted recently on this block; N = recent same-family planting (rotation rule violated)',
      '- compGood / compBad = neighbouring crops already on the block that pair well or badly with this seed',
      "- narrow: Y = the block is physically too narrow for this crop's row spacing (rows wouldn't fit cleanly)",
      '- threeSisters: Y = the seed is corn / legume / or cucurbit (the three-sisters trio bonuses if grouped). Only call a row three sisters when corn, a legume and a cucurbit all end up on that block',
      '',
      'Rules (selection):',
      '- Total plants assigned for each stockItemId must equal its plantsAvailable (or as close as possible).',
      '- For each (seed, block) pick: plants must be ≤ plantsFit and > 0. Leave a seed out of assignments when it has no room; do not list it with 0 plants.',
      '- A seed may be split across multiple blocks; sum across blocks ≤ plantsAvailable.',
      '- SPREAD BEFORE LEAVING SEED: when a seed does not fit on one block, put the rest on the other picked blocks before leaving any of it unplaced. Leave seed unplaced only when every other block is full or has a reason against it: a crop to keep apart from it, the same crop family planted there too recently, a different crop there that it would cross with, the wrong sun, or rows too wide for the block. The validator rejects a plan that leaves seed unplaced while such a block still has room.',
      "- RULES APPLY TO YOUR OWN PLAN TOO: compBad only lists crops already on a block. Never put two of this plan's crops that must be kept apart on the same block. When a seed goes on more than one block, only its first part may go where rotationOk=N or beside a different crop it would cross with; the validator rejects the rest.",
      ...(keepSeeds.length > 0
        ? [
            `- KEEP IN ONE BED: the farmer wants ${keepSeeds.map((k) => k.stockItemId).join(', ')} (keep_in_one_bed=Y) on one block each. Never put one of these on two blocks; leave what does not fit unplaced.`
          ]
        : []),
      '- Never select a row where compBad is non-empty unless no other option exists.',
      '',
      'HARD CAPS (a violation here will be rejected by the validator):',
      '- DENSITY CAP: never propose an assignment with utilizationPct > 1.25 ("badly surplus") when the same seed has any other viable block (sunMatch ≠ none AND narrow=N) where utilizationPct ≤ 1.25 is achievable. Split or reduce the assignment to avoid jamming a block.',
      "- BLOCK SPACE CAP: crops share a block. Each assignment uses plants / plantsFit of the block, and the sum over every crop on one block must not exceed 1.25 (on a shared bed: the areaShare values must not exceed its free_share). Two crops on one block means roughly half of each crop's plantsFit, not the full amount of both.",
      '- COMBINED-FAMILY DENSITY CAP: when multiple varieties of the same family (e.g., several cucurbits, several brassicas) land on the same block, the SUM of their assigned plants across that block must not exceed plantsFit by more than 25% of the largest single-variety plantsFit on that block. If it does, REDUCE the smaller varieties or move them to other blocks. Cucurbits especially: a vining cultivar (vine_spread ≥ 10 ft) effectively claims the whole block — flag others for displacement.',
      '- Prefer sufficiency=match > surplus > deficit, but never push surplus past 1.25× when alternatives exist.',
      '',
      'Soft preferences:',
      '- Prefer sunMatch=full > partial = unknown > none.',
      '- Prefer rotationOk=Y. Only use rotationOk=N when no Y options remain.',
      '- When threeSisters=Y for corn+legume+cucurbit, group them on the same block when capacity allows.',
      '- Avoid blocks with narrow=Y for that crop.',
      '',
      'Rationale style (READ CAREFULLY — the rationale text is shown directly to a non-technical farmer):',
      '- Write in plain English. Translate every column meaning above into normal language.',
      '- BAD: "All rows show deficit sufficiency and partial sun match equally, and narrow=Y applies to all options"',
      '- GOOD: "You only have enough seed to plant about half this block, and every option has only partial sun for this crop, so I picked the block with the best soil-rotation history."',
      '- Mention concrete numbers when helpful: "0.5 lb of seed = ~1,400 plants but the block fits ~2,800, so you\'d use about half the bed".',
      '- Never use the words "sufficiency", "utilization", "sunMatch", "rotationOk", "compGood", "compBad", "narrow", "threeSisters", "matrix", "row", "column", or "Y/N" in your output.',
      '- For the top-level "rationale" field: 2-4 sentences explaining the overall strategy in farmer-friendly language.',
      '- For each assignment\'s "rationale": one sentence saying *why* this seed went on this block, again in plain English.',
      '',
      'ADVISORIES — flag things the farmer might want to reconsider:',
      'You are allocating seeds onto blocks the farmer already laid out. Treat the farmer as the expert on what those blocks should look like, BUT they may have overlooked something. After producing the assignments, look at the result and surface 0–4 short advisories — each one a single plain-English sentence — for issues the farmer might want to address. Quality matters more than quantity; if nothing notable comes up, return an empty array. Examples of useful advisories:',
      '- "Block <name> has more than twice the capacity of your <crop> seed — you might want to reorder more seed or split it with a fast-growing companion like radishes."',
      '- "All four of your cucurbit varieties ended up on Block <name>; consider splitting two onto Block <other> next year so a single squash-borer outbreak doesn\'t wipe out the lot."',
      '- "Block <name> is too narrow for <crop>\'s recommended row spacing; widening it by a few feet or pairing it with a smaller-spaced crop would let you plant more efficiently."',
      '- "You have leftover seed but no remaining blocks; consider carving a new bed out of available field space, or planning a succession sowing in 4–6 weeks."',
      '- "<Crop A> and <Crop B> are good companions and together would fit on one block — you could free up a whole block for a different crop."',
      'Do NOT repeat what is already in the per-row rationale. Advisories are for things ABOVE the per-pairing decision: block sizing, companion-planting opportunities, missed succession options, leftover-seed strategy, disease-risk concentration, etc. Be concrete (name specific blocks and crops). Do not lecture; assume the farmer knows their land. Do not invent observations to fill the array — empty is fine.',
      '',
      'Respond with VALID JSON only — no markdown, no commentary outside the JSON. Schema:',
      '{',
      '  "rationale": "2-4 sentence plain-English overview",',
      '  "assignments": [',
      '    { "stockItemId": "...", "blockId": "...", "plants": <int>, "areaShare": <number 0-1, shared beds only>, "rationale": "1 plain-English sentence" }',
      '  ],',
      '  "advisories": ["short observation", "another short observation"]',
      '}'
    ].join('\n') + pollinationSection
  );
}

// ─── Validation ──────────────────────────────────────────────────────────

export type ValidatedPlan =
  | { valid: true; plan: { assignments: AiAssignment[]; rationale: string; advisories: string[] } }
  | { valid: false; violations: string[] };

/** Every crop on a block together may use at most this many blocks' worth
 *  of space (sum of plants / plantsFit). */
export const BLOCK_SHARE_CAP = 1.25;

export interface ValidateOptions {
  /** Refine only: each lot's plant total in the plan the farmer was shown.
   *  A lot the farmer's request brought below that total is a reduction the
   *  farmer asked for, so it is not checked for room left on other blocks. */
  previousTotals?: ReadonlyMap<string, number>;
}

export function validateAiPlan(
  raw: unknown,
  input: PlanInput,
  matrix: MatrixRow[],
  options: ValidateOptions = {}
): ValidatedPlan {
  const violations: string[] = [];
  if (!raw || typeof raw !== 'object') {
    return { valid: false, violations: ['response was not an object'] };
  }
  const obj = raw as { assignments?: unknown; rationale?: unknown; advisories?: unknown };
  if (!Array.isArray(obj.assignments)) {
    return { valid: false, violations: ['assignments must be an array'] };
  }

  const matrixIndex = new Map<string, MatrixRow>();
  for (const r of matrix) matrixIndex.set(`${r.stockItemId}:${r.blockId}`, r);

  const seedById = new Map<string, SeedRequest>();
  for (const s of input.seeds) seedById.set(s.stockItemId, s);

  const blocksById = new Set<string>(input.blocks.map((b) => b.id));

  // Track per-seed sum and per-block by-plugin sum.
  const sumPerSeed = new Map<string, number>();
  const sumPerBlockPerPlugin = new Map<string, number>();
  const validAssignments: AiAssignment[] = [];

  for (let i = 0; i < obj.assignments.length; i++) {
    const a = obj.assignments[i];
    if (!a || typeof a !== 'object') {
      violations.push(`assignment[${i}] is not an object`);
      continue;
    }
    const item = a as Partial<AiAssignment>;
    if (typeof item.stockItemId !== 'string' || typeof item.blockId !== 'string') {
      violations.push(`assignment[${i}] missing stockItemId or blockId`);
      continue;
    }
    const share = typeof item.areaShare === 'number' ? item.areaShare : undefined;
    if (item.plants === 0 && share === undefined) continue;
    const seed = seedById.get(item.stockItemId);
    if (!seed) {
      violations.push(`assignment[${i}] references unknown stockItemId ${item.stockItemId}`);
      continue;
    }
    if (!blocksById.has(item.blockId)) {
      violations.push(`assignment[${i}] references unknown blockId ${item.blockId}`);
      continue;
    }
    const matrixRow = matrixIndex.get(`${item.stockItemId}:${item.blockId}`);
    if (!matrixRow) {
      violations.push(
        `assignment[${i}] (${item.stockItemId} → ${item.blockId}) is not in the candidacy matrix`
      );
      continue;
    }
    let plantsInt: number;
    if (matrixRow.sharedBed && share !== undefined) {
      if (!Number.isFinite(share) || share <= 0 || share > BED_SHARE_CAP) {
        violations.push(`assignment[${i}] areaShare must be greater than 0 and at most 1`);
        continue;
      }
      plantsInt = plantsForShare(share, matrixRow.fullFit);
      if (plantsInt < 1) {
        violations.push(
          `assignment[${i}] areaShare=${share} of ${item.blockId} is too small for one plant of ${item.stockItemId}`
        );
        continue;
      }
    } else {
      if (typeof item.plants !== 'number' || !Number.isFinite(item.plants) || item.plants < 0) {
        violations.push(`assignment[${i}] plants must be a positive number`);
        continue;
      }
      plantsInt = Math.floor(item.plants);
      if (plantsInt === 0) continue;
    }
    if (plantsInt > matrixRow.plantsFit) {
      violations.push(
        `assignment[${i}] plants=${plantsInt} exceeds plantsFit=${matrixRow.plantsFit} for (${item.stockItemId}, ${item.blockId})`
      );
      continue;
    }
    if (matrixRow.companionBadHere.length > 0) {
      violations.push(
        `assignment[${i}] places ${item.stockItemId} on ${item.blockId} which already hosts a bad-companion (${matrixRow.companionBadHere.join(', ')})`
      );
      continue;
    }
    sumPerSeed.set(item.stockItemId, (sumPerSeed.get(item.stockItemId) ?? 0) + plantsInt);

    const blockPluginKey = `${item.blockId}:${seed.cropPluginId}`;
    sumPerBlockPerPlugin.set(
      blockPluginKey,
      (sumPerBlockPerPlugin.get(blockPluginKey) ?? 0) + plantsInt
    );

    validAssignments.push({
      stockItemId: item.stockItemId,
      blockId: item.blockId,
      plants: plantsInt,
      rationale: typeof item.rationale === 'string' ? item.rationale : ''
    });
  }

  if (obj.assignments.length > 0 && validAssignments.length === 0 && violations.length === 0) {
    violations.push('every assignment has 0 plants');
  }

  // Per-seed sum cannot exceed available.
  for (const [stockItemId, total] of sumPerSeed) {
    const seed = seedById.get(stockItemId);
    if (seed && total > seed.quantityPlants) {
      violations.push(
        `total plants for ${stockItemId} = ${total} exceeds available ${seed.quantityPlants}`
      );
    }
  }

  // Per (block, plugin) sum cannot exceed plantsFit (capacity is shared).
  for (const [key, total] of sumPerBlockPerPlugin) {
    const [blockId, pluginId] = key.split(':');
    const matrixRow = matrix.find((r) => r.blockId === blockId && r.cropPluginId === pluginId);
    if (matrixRow && total > matrixRow.plantsFit) {
      violations.push(
        `total plants on block ${blockId} for ${pluginId} = ${total} exceeds plantsFit ${matrixRow.plantsFit}`
      );
    }
  }

  // ─── Density caps (Phase 15e — block over-pack guard) ───────────────────
  //
  // (a) Per-assignment cap: any single (seed, block) assignment with
  //     utilizationPct > 1.25 is rejected when the same seed has any other
  //     viable block (sunMatch !== 'none' AND narrow=false) where it could
  //     be placed under the cap. Splitting / reducing across blocks is
  //     always preferred over jamming one block.
  // (b) Per-(block, family) combined cap: when multiple varieties of the
  //     same family land on a block, the sum of their plants across that
  //     family on that block cannot exceed plantsFit by more than 25% of
  //     the largest single-variety plantsFit. Otherwise the block is
  //     effectively over-packed by mixed-cultivar density.
  //
  // These rules backstop the prompt — Claude is told to obey them, but the
  // validator catches mistakes and routes to the retry path.

  const seedFamilyByStockId = new Map<string, string>();
  for (const seed of input.seeds) {
    const plug = input.pluginIndex[seed.cropPluginId];
    if (plug) seedFamilyByStockId.set(seed.stockItemId, plug.cropFamily);
  }

  // (a) Per-assignment density cap when alternatives exist.
  const seedHasAlternativeUnderCap = new Map<string, boolean>();
  const onSharedBed = (a: AiAssignment) =>
    matrixIndex.get(`${a.stockItemId}:${a.blockId}`)?.sharedBed === true;
  for (const a of validAssignments) {
    const seed = seedById.get(a.stockItemId);
    if (!seed) continue;
    if (onSharedBed(a)) continue;
    if (seedHasAlternativeUnderCap.has(a.stockItemId)) continue;
    const candidates = matrix.filter(
      (r) =>
        r.stockItemId === a.stockItemId &&
        r.blockId !== a.blockId &&
        r.sunMatch !== 'none' &&
        !r.narrowBlock &&
        r.companionBadHere.length === 0 &&
        r.plantsFit > 0
    );
    seedHasAlternativeUnderCap.set(a.stockItemId, candidates.length > 0);
  }
  for (const a of validAssignments) {
    const matrixRow = matrixIndex.get(`${a.stockItemId}:${a.blockId}`);
    if (!matrixRow || matrixRow.plantsFit <= 0 || matrixRow.sharedBed) continue;
    const utilization = a.plants / matrixRow.plantsFit;
    if (utilization > 1.25 && seedHasAlternativeUnderCap.get(a.stockItemId)) {
      violations.push(
        `assignment ${a.stockItemId}→${a.blockId} packs ${a.plants}/${matrixRow.plantsFit} plants ` +
          `(${utilization.toFixed(2)}× capacity). Reduce or split: this seed has another viable block ` +
          `(sun match, not narrow) where utilization ≤ 1.25 is achievable.`
      );
    }
  }

  // (b) Per-(block, family) combined density cap.
  const blockFamilyAssignments = new Map<string, AiAssignment[]>();
  for (const a of validAssignments) {
    const family = seedFamilyByStockId.get(a.stockItemId);
    if (!family || onSharedBed(a)) continue;
    const key = `${a.blockId}:${family}`;
    const list = blockFamilyAssignments.get(key) ?? [];
    list.push(a);
    blockFamilyAssignments.set(key, list);
  }
  for (const [key, items] of blockFamilyAssignments) {
    if (items.length < 2) continue;
    const [blockId] = key.split(':');
    let totalPlants = 0;
    let maxFit = 0;
    const detail: string[] = [];
    for (const a of items) {
      const m = matrixIndex.get(`${a.stockItemId}:${blockId}`);
      if (!m) continue;
      totalPlants += a.plants;
      if (m.plantsFit > maxFit) maxFit = m.plantsFit;
      detail.push(`${a.stockItemId}=${a.plants}/${m.plantsFit}`);
    }
    if (maxFit > 0 && totalPlants > maxFit * 1.25) {
      violations.push(
        `block ${blockId} packs multiple ${seedFamilyByStockId.get(items[0].stockItemId)} ` +
          `varieties: total ${totalPlants} plants exceeds 1.25× the largest plantsFit (${maxFit}). ` +
          `Reduce or move some varieties to other blocks. (${detail.join(', ')})`
      );
    }
  }

  // (c) Per-block combined space cap across every crop. plantsFit is what
  // the whole block holds at one crop's spacing, so plants / plantsFit is
  // the share of the block that assignment uses; the shares must add up to
  // one block (with the same 25% slack as the caps above).
  // #440 — on a shared garden or greenhouse bed the shares are of the whole
  // bed and must fit in its free share (at most 1.0, no slack).
  const blockShare = new Map<
    string,
    { share: number; detail: string[]; cap: number; sharedBed: boolean }
  >();
  for (const a of validAssignments) {
    const m = matrixIndex.get(`${a.stockItemId}:${a.blockId}`);
    if (!m) continue;
    const denom = m.sharedBed ? m.fullFit : m.plantsFit;
    if (denom <= 0) continue;
    const entry = blockShare.get(a.blockId) ?? {
      share: 0,
      detail: [],
      cap: m.sharedBed ? m.freeShare : BLOCK_SHARE_CAP,
      sharedBed: m.sharedBed
    };
    entry.share += a.plants / denom;
    entry.detail.push(`${a.stockItemId}=${a.plants}/${denom}`);
    blockShare.set(a.blockId, entry);
  }
  for (const [blockId, { share, detail, cap, sharedBed }] of blockShare) {
    if (sharedBed) {
      if (share > cap + SHARE_EPSILON + 0.005) {
        violations.push(
          `shared bed ${blockId} is over-packed: its crops' area shares add up to ${share.toFixed(2)} ` +
            `but only ${cap} of the bed is free. Give each crop a smaller areaShare so they add up to ` +
            `${cap} or less. (${detail.join(', ')})`
        );
      }
      continue;
    }
    if (share > BLOCK_SHARE_CAP) {
      violations.push(
        `block ${blockId} is over-packed: its crops together use ${share.toFixed(2)}× the block ` +
          `(each assignment uses plants/plantsFit of the block; the sum must be ≤ ${BLOCK_SHARE_CAP}). ` +
          `Reduce plants or move crops to other blocks. (${detail.join(', ')})`
      );
    }
  }

  // (d) Phase 35 (R-17): a counted lot must spread over the picked blocks
  // before any of it is left, and a keep-in-one-bed lot stays on one block.
  const asPlaced: Assignment[] = validAssignments.map((a) => {
    const seed = seedById.get(a.stockItemId)!;
    return {
      stockItemId: a.stockItemId,
      cropPluginId: seed.cropPluginId,
      varietyDisplayName: seed.varietyDisplayName,
      blockId: a.blockId,
      plants: a.plants,
      score: 0
    };
  });
  // (e) Claude's parts meet the same rule-outs the engine applies with the
  // crops it has already placed (R-05): no part lands beside a crop it must
  // be kept apart from, wherever that crop sits in this plan, and at most one
  // part of a lot (its first) sits on a block its rotation or a crossing crop
  // on that block rules out.
  const apartSeen = new Set<string>();
  for (const a of asPlaced) {
    const already = new Set(keepApartCrops(input, a.cropPluginId, a.blockId, []));
    const apart = keepApartCrops(input, a.cropPluginId, a.blockId, asPlaced).filter(
      (p) => !already.has(p)
    );
    if (apart.length === 0) continue;
    const key = [a.blockId, ...[a.cropPluginId, apart[0]].sort()].join('|');
    if (apartSeen.has(key)) continue;
    apartSeen.add(key);
    violations.push(
      `keep-apart: ${a.stockItemId} (${a.cropPluginId}) is on ${a.blockId} with ${apart.join(', ')}, which must be kept apart. Move one of them to a different block.`
    );
  }
  for (const seed of input.seeds) {
    const plugin = input.pluginIndex[seed.cropPluginId];
    if (!plugin) continue;
    const mine = asPlaced.filter((a) => a.stockItemId === seed.stockItemId);
    if (mine.length < 2) continue;
    const ruled = mine.filter(
      (a) =>
        rotationConflict(input, plugin, a.blockId) !== null ||
        crossingCrop(input, plugin, a.blockId, asPlaced) !== null
    );
    if (ruled.length > 1) {
      violations.push(
        `split-ruled-out: ${seed.stockItemId} has parts on ${ruled.map((a) => a.blockId).join(', ')}, where its rotation or a crop it crosses with rules it out. Only one part of a lot may go on such a block.`
      );
    }
  }

  for (const seed of input.seeds) {
    if (seed.fillToCapacity) continue;
    const mine = asPlaced.filter((a) => a.stockItemId === seed.stockItemId);
    if (seed.keepInOneBed) {
      const blocks = new Set(mine.map((a) => a.blockId));
      if (blocks.size > 1) {
        violations.push(
          `kept-in-one-bed: ${seed.stockItemId} must stay on one block but is on ${[...blocks].join(', ')}. Keep it on one block and leave the rest unplaced.`
        );
      }
      continue;
    }
    const total = mine.reduce((sum, a) => sum + a.plants, 0);
    const before = options.previousTotals?.get(seed.stockItemId);
    if (before !== undefined && total < before) continue;
    const roomy = blocksWithRoomForLeftover(input, seed, asPlaced);
    if (roomy.length > 0) {
      violations.push(
        `unplaced-with-room: ${seed.stockItemId} has ${seed.quantityPlants - total} plants left but ${roomy.join(', ')} still ${roomy.length === 1 ? 'has' : 'have'} room for it. Put the rest there before leaving seed unplaced.`
      );
    }
  }

  if (violations.length > 0) return { valid: false, violations };
  const rationale = typeof obj.rationale === 'string' ? obj.rationale : '';
  const advisories = Array.isArray(obj.advisories)
    ? obj.advisories
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
        .slice(0, 6)
    : [];
  return { valid: true, plan: { assignments: validAssignments, rationale, advisories } };
}

// ─── Engine fallback ─────────────────────────────────────────────────────

/**
 * Phase 25d (#184 / FP-004) — public deterministic-only entry point.
 *
 * Endpoints call this when the AI guard short-circuits (cap-exceeded /
 * quota-exceeded). Invariant 7 — "AI assists, never gates" — requires
 * every degradation path to return a usable plan, never an HTTP 4xx.
 * Builds the candidacy matrix + pollination layer locally so callers
 * don't need to repeat that setup.
 */
export function allocateDeterministic(
  input: PlanInput,
  reason: 'no-api-key' | 'over-cap' | 'quota-exceeded' | 'ai-unavailable',
  detail?: string | null,
  locale?: string | null
): AllocationResult {
  const matrix = buildCandidacyMatrix(input);
  return engineFallback(input, matrix, reason, detail, locale);
}

function engineFallback(
  input: PlanInput,
  matrix: MatrixRow[],
  reason: 'engine-only' | 'no-api-key' | 'over-cap' | 'quota-exceeded' | 'ai-unavailable',
  detail?: string | null,
  locale?: string | null
): AllocationResult {
  const result = planLayout(input);
  const sufficiency = computeSufficiencyByPair(result.assignments, input);
  const perRowRationale: Record<string, string> = {};
  const lots = splitLotParts(result.assignments);
  for (const a of result.assignments) {
    const row = matrix.find((r) => r.stockItemId === a.stockItemId && r.blockId === a.blockId);
    const seed = input.seeds.find((s) => s.stockItemId === a.stockItemId);
    const lot = lots.get(a.stockItemId);
    perRowRationale[`${a.stockItemId}:${a.blockId}`] = row
      ? engineRationale(
          row,
          seed,
          locale,
          threeSistersOnBlock(input, a.blockId, result.assignments),
          lot
            ? { parts: lot.parts, placed: lot.placed, first: lot.firstBlockId === a.blockId }
            : undefined
        )
      : t(locale, 'wizard.engine.placed');
  }
  const layer = buildPollinationLayer(input);
  return {
    assignments: result.assignments,
    unplaced: result.unplaced,
    leftover: result.leftover,
    sufficiency,
    rationale:
      reason === 'no-api-key'
        ? t(locale, 'wizard.engine.fb.noKey')
        : reason === 'over-cap'
          ? t(locale, 'wizard.engine.fb.overCap')
          : reason === 'quota-exceeded'
            ? t(locale, 'wizard.engine.fb.quota')
            : reason === 'ai-unavailable'
              ? t(locale, 'wizard.engine.fb.unavailable', {
                  detail: detail ?? t(locale, 'wizard.engine.fb.unavailableDefault')
                })
              : t(locale, 'wizard.engine.fb.invalid'),
    perRowRationale,
    advisories: engineAdvisories(input, matrix, result.assignments, result.unplaced, locale),
    pollinationConstraints: computePollinationConstraints(result.assignments, input, layer),
    geometryMissingBlockIds: layer.geometryMissingBlockIds,
    companionGroups: [],
    meta: {
      model: 'engine-fallback',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      usdEstimate: 0,
      fallback: reason
    }
  };
}

/** Deterministic advisories the engine can flag without Claude. Kept narrow
 *  on purpose — concentration risk, oversized blocks, narrow blocks, leftover
 *  seed. Anything more nuanced is the AI's job. */
function engineAdvisories(
  input: PlanInput,
  matrix: MatrixRow[],
  assignments: ReadonlyArray<Assignment>,
  unplaced: ReadonlyArray<SeedRequest>,
  locale?: string | null
): string[] {
  const out: string[] = [];
  const blockNameOf = (id: string) => {
    const b = input.blocks.find((x) => x.id === id);
    return b?.blockLabel ?? b?.name ?? id;
  };
  const seedNameOf = (id: string) =>
    input.seeds.find((s) => s.stockItemId === id)?.varietyDisplayName ?? id;

  // 1) Block significantly underused (deficit > 50%) — farmer should
  //    consider more seed, a companion, or a smaller bed.
  for (const a of assignments) {
    const row = matrix.find((r) => r.stockItemId === a.stockItemId && r.blockId === a.blockId);
    if (!row) continue;
    if (row.plantsFit > 0 && a.plants / row.plantsFit < 0.5) {
      out.push(
        t(locale, 'wizard.engine.adv.underused', {
          block: blockNameOf(a.blockId),
          pct: Math.round((a.plants / row.plantsFit) * 100),
          seed: seedNameOf(a.stockItemId)
        })
      );
      break; // one of these is enough; the AI version can elaborate.
    }
  }

  // 2) Disease-risk concentration — same family on most/all selected blocks.
  const familyByBlock = new Map<string, Set<string>>();
  for (const a of assignments) {
    const plug = input.pluginIndex[a.cropPluginId];
    if (!plug) continue;
    const fams = familyByBlock.get(a.blockId) ?? new Set();
    fams.add(plug.cropFamily);
    familyByBlock.set(a.blockId, fams);
  }
  const familyCounts = new Map<string, number>();
  for (const fams of familyByBlock.values()) {
    for (const f of fams) familyCounts.set(f, (familyCounts.get(f) ?? 0) + 1);
  }
  const blockCount = familyByBlock.size;
  for (const [fam, n] of familyCounts) {
    if (blockCount >= 2 && n === blockCount && fam !== '') {
      out.push(t(locale, 'wizard.engine.adv.family', { family: fam }));
      break;
    }
  }

  // 3) Narrow-block warning — a chosen block is too narrow for its crop.
  for (const a of assignments) {
    const row = matrix.find((r) => r.stockItemId === a.stockItemId && r.blockId === a.blockId);
    if (row?.narrowBlock) {
      out.push(
        t(locale, 'wizard.engine.adv.narrow', {
          block: blockNameOf(a.blockId),
          seed: seedNameOf(a.stockItemId)
        })
      );
      break;
    }
  }

  // 4) Unplaced leftover seed — point the farmer at adding a bed or
  //    succession sowing rather than just dropping it on the floor.
  const allUnsized =
    input.blocks.length > 0 &&
    input.blocks.every(
      (b) => usableSqft(b).sqft <= 0 && !((b.widthFt ?? 0) > 0 && (b.lengthFt ?? 0) > 0)
    );
  if (unplaced.length > 0 && allUnsized) {
    out.push(t(locale, 'wizard.engine.adv.unsized'));
  } else if (unplaced.length > 0) {
    const names = unplaced
      .map((u) => seedNameOf(u.stockItemId))
      .slice(0, 3)
      .join(', ');
    out.push(
      t(locale, 'wizard.engine.adv.unplaced', {
        names: `${names}${unplaced.length > 3 ? ', …' : ''}`
      })
    );
  }

  return out.slice(0, 4);
}

/** Why the engine put a seed on a block. A seed with no known amount is
 *  sized to the block, so it gets no surplus sentence; a crop sown by area
 *  (#555) is in square feet, never plants. */
function engineRationale(
  row: MatrixRow,
  seed?: Pick<SeedRequest, 'fillToCapacity' | 'byArea'>,
  locale?: string | null,
  threeSistersHere = false,
  split?: { parts: number; placed: number; first: boolean }
): string {
  const bits: string[] = [];
  const num = (n: number) => numberToLocaleString(n, intlLocale(locale));
  if (seed?.fillToCapacity) {
    bits.push(t(locale, 'wizard.engine.why.fill'));
  } else if (split && !split.first) {
    bits.push(t(locale, 'wizard.engine.why.splitPart'));
  } else if (split) {
    const extra = row.plantsAvailable - split.placed;
    bits.push(
      extra > 0
        ? t(
            locale,
            seed?.byArea ? 'wizard.engine.why.splitSurplusArea' : 'wizard.engine.why.splitSurplus',
            {
              parts: split.parts,
              fit: num(split.placed),
              avail: num(row.plantsAvailable),
              extra: num(extra)
            }
          )
        : t(locale, 'wizard.engine.why.splitAll', { parts: split.parts })
    );
  } else if (row.sufficiency === 'match') {
    bits.push(t(locale, 'wizard.engine.why.match'));
  } else if (row.sufficiency === 'surplus') {
    const extra = row.plantsAvailable - row.plantsFit;
    bits.push(
      t(locale, seed?.byArea ? 'wizard.engine.why.surplusArea' : 'wizard.engine.why.surplus', {
        fit: num(row.plantsFit),
        avail: num(row.plantsAvailable),
        extra: num(extra)
      })
    );
  } else if (row.sufficiency === 'deficit') {
    bits.push(
      t(locale, 'wizard.engine.why.deficit', { pct: Math.round(row.utilizationPct * 100) })
    );
  }
  if (row.sunMatch === 'full') bits.push(t(locale, 'wizard.engine.why.sunFull'));
  else if (row.sunMatch === 'partial') bits.push(t(locale, 'wizard.engine.why.sunPartial'));
  else if (row.sunMatch === 'unknown') bits.push(t(locale, 'wizard.engine.why.sunUnknown'));
  if (!row.rotationOk) {
    bits.push(t(locale, 'wizard.engine.why.rotation'));
  }
  if (row.narrowBlock) {
    bits.push(t(locale, 'wizard.engine.why.narrow'));
  }
  if (row.threeSistersCandidate && threeSistersHere)
    bits.push(t(locale, 'wizard.engine.why.threeSisters'));
  return bits.length > 0 ? bits.join('. ') + '.' : t(locale, 'wizard.engine.placedDot');
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Lots the plan puts on more than one block: how many parts, the plants
 *  (or sq ft) placed across all of them, and the block whose row carries
 *  the lot's one leftover sentence. */
export function splitLotParts(
  assignments: ReadonlyArray<Pick<Assignment, 'stockItemId' | 'blockId' | 'plants'>>
): Map<string, { parts: number; placed: number; firstBlockId: string }> {
  const out = new Map<string, { parts: number; placed: number; firstBlockId: string }>();
  for (const a of assignments) {
    const cur = out.get(a.stockItemId);
    if (cur) {
      cur.parts += 1;
      cur.placed += a.plants;
    } else {
      out.set(a.stockItemId, { parts: 1, placed: a.plants, firstBlockId: a.blockId });
    }
  }
  for (const [id, v] of out) if (v.parts < 2) out.delete(id);
  return out;
}

/** #690: corn, a legume and a cucurbit all on the block (its standing crops
 *  plus this plan), the same test the engine's three-sisters bonus uses. */
export function threeSistersOnBlock(
  input: PlanInput,
  blockId: string,
  assignments: ReadonlyArray<Pick<Assignment, 'blockId' | 'cropPluginId'>>
): boolean {
  const families = new Set<string>();
  for (const id of cropsOnBlock(input, blockId, assignments)) {
    const family = input.pluginIndex[id]?.cropFamily;
    if (family) families.add(family);
  }
  return families.has('corn') && families.has('legume') && families.has('cucurbit');
}

function computeSufficiencyByPair(
  assignments: ReadonlyArray<Assignment>,
  input: PlanInput
): Record<string, SufficiencyResult> {
  const out: Record<string, SufficiencyResult> = {};
  for (const a of assignments) {
    const seed = input.seeds.find((s) => s.stockItemId === a.stockItemId);
    const block = input.blocks.find((b) => b.id === a.blockId);
    const plugin = input.pluginIndex[a.cropPluginId];
    if (!seed || !block || !plugin) continue;
    const sharedBed = (input.bedBlockIds ?? []).includes(block.id);
    out[`${a.stockItemId}:${a.blockId}`] = sufficiencyOf({
      plantsAvailable: a.plants,
      plantsFit: sharedBed ? bedPlantsFit(block, plugin) : plantsFitUsable(block, plugin)
    });
  }
  return out;
}

function computeUnplaced(
  seeds: ReadonlyArray<SeedRequest>,
  assignments: ReadonlyArray<Assignment>
): SeedRequest[] {
  const placed = new Map<string, number>();
  for (const a of assignments) {
    placed.set(a.stockItemId, (placed.get(a.stockItemId) ?? 0) + a.plants);
  }
  return seeds
    .filter((s) =>
      s.fillToCapacity
        ? (placed.get(s.stockItemId) ?? 0) === 0
        : (placed.get(s.stockItemId) ?? 0) < s.quantityPlants
    )
    .map((s) => ({
      ...s,
      quantityPlants: s.quantityPlants - (placed.get(s.stockItemId) ?? 0)
    }));
}

interface ClaudeCallResult {
  parsed: unknown;
  /** Raw assistant text — kept so the retry can echo it back AND so the
   *  threading hook can persist it as the turn's assistant response. */
  rawText: string;
  meta: AiResultMeta;
}

interface TelemetryConfig {
  planningSessionId?: string;
  contextCacheHit: boolean;
  derivedSignalHit: boolean;
}

/** Stringify a previously-parsed AI response back into JSON text so we can
 *  echo it on a retry. */
function stringifyForRetry(parsed: unknown): string {
  try {
    return JSON.stringify(parsed ?? { assignments: [] }, null, 2);
  } catch {
    return '{ "assignments": [] }';
  }
}

/**
 * Phase 15e — multi-turn retry for the Allocation AI. Sends the original
 * prompt, then the previous (rejected) assistant response, then a targeted
 * correction prompt listing the violations. Lets Claude amend rather than
 * restart — especially valuable for semantic violations like density caps
 * exceeded, plantsFit overflow, or compatibility-table misses.
 */
async function retryWithSemanticContext(
  client: Anthropic,
  model: string,
  system: { type: 'text'; text: string; cache_control: { type: 'ephemeral' } }[],
  firstUserPrompt: string,
  previousAssistantText: string,
  violations: ReadonlyArray<string>,
  telemetry: TelemetryConfig
): Promise<ClaudeCallResult> {
  const correctionText =
    'Your previous response was rejected by the validator. Violations:\n' +
    violations.map((v) => `- ${v}`).join('\n') +
    '\n\nReturn a CORRECTED plan. Keep the parts of your previous answer ' +
    'that were not flagged; change only what the violations require. ' +
    'Same JSON shape as before. No prose, no code fences.';

  const startMs = Date.now();
  const msg = await client.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: [
      { role: 'user', content: [{ type: 'text', text: firstUserPrompt }] },
      { role: 'assistant', content: [{ type: 'text', text: previousAssistantText }] },
      { role: 'user', content: [{ type: 'text', text: correctionText }] }
    ]
  });
  const durationMs = Date.now() - startMs;
  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    parsed = null;
  }
  const meta = computeMeta(msg.usage, model);
  recordAllocateTelemetry(meta, durationMs, telemetry);
  appendAllocateTurn(telemetry.planningSessionId, correctionText, text, meta);
  return { parsed, rawText: text, meta };
}

async function callClaude(
  client: Anthropic,
  model: string,
  system: { type: 'text'; text: string; cache_control: { type: 'ephemeral' } }[],
  userPrompt: string,
  telemetry: TelemetryConfig
): Promise<ClaudeCallResult> {
  // Phase 17 (Track 3.4) — thread prior turns when a session is supplied.
  const messages = buildThreadedMessages(telemetry.planningSessionId, userPrompt).map((m) => ({
    role: m.role,
    content: [{ type: 'text' as const, text: m.content }]
  }));
  const startMs = Date.now();
  const msg = await client.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages
  });
  const durationMs = Date.now() - startMs;
  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    parsed = null;
  }
  const meta = computeMeta(msg.usage, model);
  recordAllocateTelemetry(meta, durationMs, telemetry);
  appendAllocateTurn(telemetry.planningSessionId, userPrompt, text, meta);
  return { parsed, rawText: text, meta };
}

function computeMeta(rawUsage: unknown, model: string): AiResultMeta {
  const usage =
    (rawUsage as {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens?: number;
    }) ?? {};
  const choice = selectModel('allocate');
  const meta: AiResultMeta = {
    model,
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    cachedInputTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    usdEstimate: 0
  };
  meta.usdEstimate = estimateUsd(meta, choice, usage);
  return meta;
}

function recordAllocateTelemetry(
  meta: AiResultMeta,
  durationMs: number,
  telemetry: TelemetryConfig
): void {
  recordAiCall({
    endpoint: 'allocate',
    model: meta.model,
    contextCacheHit: telemetry.contextCacheHit,
    derivedSignalHit: telemetry.derivedSignalHit,
    inputTokens: meta.inputTokens,
    cachedInputTokens: meta.cachedInputTokens,
    outputTokens: meta.outputTokens,
    usdEstimate: meta.usdEstimate,
    durationMs,
    planningSessionId: telemetry.planningSessionId
  });
}

function appendAllocateTurn(
  planningSessionId: string | undefined,
  userPrompt: string,
  assistantResponse: string,
  meta: AiResultMeta
): void {
  if (!planningSessionId) return;
  appendTurn(planningSessionId, {
    endpoint: 'allocate',
    userPrompt,
    assistantResponse,
    inputTokens: meta.inputTokens,
    cachedInputTokens: meta.cachedInputTokens,
    outputTokens: meta.outputTokens,
    occurredAt: Date.now()
  });
}

/** Stable hash of the allocation-specific inputs (seed list + block ids).
 *  Used as the `subKey` for the candidacy-matrix derived signal so a fresh
 *  seed/block selection doesn't reuse a stale matrix from a prior call. */
export function hashInputsForMatrix(input: PlanInput): string {
  const pluginIds = new Set<string>([
    ...input.seeds.map((s) => s.cropPluginId),
    ...input.existingCrops.map((c) => c.cropPluginId)
  ]);
  return `alloc:${contentKey({
    seeds: input.seeds,
    blocks: input.blocks,
    axes: input.axes,
    existingCrops: input.existingCrops,
    companions: input.companions,
    bedBlockIds: input.bedBlockIds ?? [],
    plugins: [...pluginIds].sort().map((id) => input.pluginIndex[id] ?? null),
    day: Math.floor((input.nowMs ?? Date.now()) / DAY_MS_MATRIX)
  })}`;
}

const DAY_MS_MATRIX = 86_400_000;

function addMeta(target: AiResultMeta, src: AiResultMeta): void {
  target.inputTokens += src.inputTokens;
  target.cachedInputTokens += src.cachedInputTokens;
  target.outputTokens += src.outputTokens;
  target.usdEstimate += src.usdEstimate;
  target.model = src.model;
}
