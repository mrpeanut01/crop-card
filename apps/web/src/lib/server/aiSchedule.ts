/**
 * AI scheduling pass (Phase 20, B3 + C3).
 *
 * Takes a finalized allocation (assignments + carry-forward constraints
 * from the allocator) and produces dated `ScheduledPlanting[]` — one row
 * per planting, with succession-eligible assignments potentially split
 * into multiple dated rows.
 *
 * Inputs Claude consumes:
 *   - Frost dates + per-assignment scheduling window (B2)
 *   - Cross-pollination must-stagger constraints from the allocator (A5)
 *   - Companion-group anchor+offset markers from the allocator (B6)
 *   - Succession-fit eligibility per assignment (C1)
 *
 * Output is validated against the same candidacy data Claude saw — out-of-
 * window dates, missed staggers, and broken companion offsets are rejected
 * and either retried or replaced with the deterministic single-planting-
 * at-earliest fallback. Same fail-safe as the allocator.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { Crop } from '$lib/db/crops';
import {
  buildFarmSystemBlocks,
  estimateUsd,
  selectModel,
  type AiResultMeta,
  type FarmContext
} from './aiPlanning';
import { getApiKey } from './scanResult';
import { extractJsonObject } from './aiJsonExtract';
import {
  scheduleCandidacy,
  formatDateMs,
  type ScheduleAssignmentInput,
  type ScheduleWindow
} from '$lib/schedule/scheduleCandidacy';
import {
  evaluateSuccessionFit,
  splitQuantityForSuccession,
  type SuccessionFit
} from '$lib/schedule/succession';
import type { CompanionGroupMarker, PollinationConstraint } from '$lib/plan/types';
import { anchorStockInGroup, offsetForStockInGroup } from '$lib/plan/companionOffsets';

const ONE_DAY_MS = 86_400_000;
const MAX_OUTPUT_TOKENS = 4000;

export interface ScheduledPlanting {
  stockItemId: string;
  blockId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  /** Epoch ms. The commit endpoint passes this verbatim to `crops.plantingDate`. */
  plantingDateMs: number;
  /** Number of plants this dated planting represents. For successions, sums
   *  across all rows for the same (stockItemId, blockId) equal the original
   *  assignment's plants. */
  plants: number;
  /** Present only when the assignment was succession-split. */
  successionIndex?: { i: number; n: number };
  /** One-sentence plain-English explanation of why this date. */
  rationale: string;
}

export interface ScheduleInput {
  assignments: ScheduleAssignmentInput[];
  pluginIndex: Record<string, CropPlugin>;
  existingCrops: ReadonlyArray<Crop>;
  pollinationConstraints: ReadonlyArray<PollinationConstraint>;
  companionGroups: ReadonlyArray<CompanionGroupMarker>;
  frostDates: { lastSpringFrostMs: number; firstFallFrostMs: number };
  year: number;
}

export interface ScheduleOptions {
  planningSessionId?: string;
}

export interface ScheduleResult {
  scheduled: ScheduledPlanting[];
  rationale: string;
  advisories: string[];
  /** Echo of the candidacy windows + succession fits the prompt was built
   *  from. Useful to the chat refinement endpoint so it doesn't re-derive. */
  windows: ScheduleWindow[];
  successionFits: SuccessionFit[];
  meta: AiResultMeta & {
    fallback?: 'deterministic' | 'no-api-key';
    violations?: string[];
    /** Plain-English explanation + per-family actionable suggestions, set
     *  when the AI failed validation and we want the chat to help the
     *  operator unblock the scheduler. */
    diagnosis?: ScheduleDiagnosis;
  };
}

export interface ScheduleDiagnosis {
  /** 1-3 sentence plain-English summary of what went wrong. No JSON, no
   *  validator strings, no UUIDs. */
  summary: string;
  /** Concrete, named suggestions the operator can act on directly. Each
   *  one references actual variety names from the assignment list. */
  suggestions: string[];
}

export interface ScheduleChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ScheduleRefineInput extends ScheduleInput {
  previousScheduled: ScheduledPlanting[];
  previousRationale: string;
  previousAdvisories: string[];
  transcript: ScheduleChatTurn[];
}

export interface ScheduleRefineResult extends ScheduleResult {
  reply: string;
}

const MAX_CHAT_TURNS = 30;

/**
 * Multi-turn schedule refinement. The transcript ends with the operator's
 * new request; the assistant turns from earlier in the chat are echoed back
 * so Claude has continuity. Always returns a complete revised
 * `scheduled[]` array. Falls back to the prior plan unchanged when the
 * AI is unreachable, returns invalid output, or proposes a plan that
 * violates the candidacy windows / staggers / companion offsets.
 */
export async function refineSchedule(
  input: ScheduleRefineInput,
  ctx: FarmContext,
  options: ScheduleOptions = {}
): Promise<ScheduleRefineResult> {
  if (
    input.transcript.length === 0 ||
    input.transcript[input.transcript.length - 1].role !== 'user'
  ) {
    throw new Error('schedule transcript must end with a user message');
  }
  if (input.transcript.length > MAX_CHAT_TURNS) {
    throw new Error(`schedule transcript exceeds ${MAX_CHAT_TURNS} turns`);
  }

  const windows = scheduleCandidacy({
    assignments: input.assignments,
    pluginIndex: input.pluginIndex,
    existingCrops: input.existingCrops,
    frostDates: input.frostDates,
    year: input.year
  });
  const windowsByKey = new Map<string, ScheduleWindow>();
  for (const w of windows) windowsByKey.set(`${w.stockItemId}:${w.blockId}`, w);
  const successionFits = windows.map((w) =>
    evaluateSuccessionFit(
      w,
      input.pluginIndex[
        input.assignments.find((a) => a.stockItemId === w.stockItemId && a.blockId === w.blockId)
          ?.cropPluginId ?? ''
      ],
      w.blockId,
      w.stockItemId
    )
  );

  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      scheduled: input.previousScheduled,
      rationale: input.previousRationale,
      advisories: input.previousAdvisories,
      reply:
        "I can't refine the schedule without an Anthropic API key. The current dates are unchanged.",
      windows,
      successionFits,
      meta: {
        model: 'no-api-key',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        usdEstimate: 0,
        fallback: 'no-api-key'
      }
    };
  }

  const choice = selectModel('allocate');
  const client = new Anthropic({ apiKey });
  const systemBlocks = buildFarmSystemBlocks(ctx);
  const initialPrompt = buildSchedulePrompt(input, windows, successionFits);
  const previousAssistantJson = JSON.stringify(
    {
      rationale: input.previousRationale,
      scheduled: input.previousScheduled.map((p) => ({
        stockItemId: p.stockItemId,
        blockId: p.blockId,
        plantingDate: formatDateMs(p.plantingDateMs),
        plants: p.plants,
        successionIndex: p.successionIndex ?? null,
        rationale: p.rationale
      })),
      advisories: input.previousAdvisories
    },
    null,
    2
  );

  const messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string }[] }> =
    [
      { role: 'user', content: [{ type: 'text', text: initialPrompt }] },
      { role: 'assistant', content: [{ type: 'text', text: previousAssistantJson }] }
    ];
  const priorChat = input.transcript.slice(0, -1);
  for (const t of priorChat)
    messages.push({ role: t.role, content: [{ type: 'text', text: t.content }] });
  const newUserMessage = input.transcript[input.transcript.length - 1].content;
  messages.push({
    role: 'user',
    content: [{ type: 'text', text: buildScheduleRefinementUserMessage(newUserMessage) }]
  });

  // Wrapper around messages.create that returns parsed + raw text + usage,
  // so the first attempt + the retry pass can share it.
  async function callOnce(
    convo: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string }[] }>
  ): Promise<{
    parsed: unknown;
    rawText: string;
    usage:
      | {
          input_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
          output_tokens?: number;
        }
      | undefined;
  }> {
    try {
      const msg = await client.messages.create({
        model: choice.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: systemBlocks,
        messages: convo
      });
      const u = msg.usage as
        | {
            input_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
            output_tokens?: number;
          }
        | undefined;
      const txt = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
      const p = extractJsonObject(txt);
      if (p === null && txt.length > 0) {
        const preview = txt.length > 800 ? `${txt.slice(0, 800)}…` : txt;
        console.warn(
          '[aiSchedule.refine] could not extract JSON from model response. Raw text:\n' + preview
        );
      }
      return { parsed: p, rawText: txt, usage: u };
    } catch (err) {
      console.warn(
        '[aiSchedule.refine] Anthropic call failed:',
        err instanceof Error ? err.message : String(err)
      );
      return { parsed: null, rawText: '', usage: undefined };
    }
  }

  const meta: AiResultMeta = {
    model: choice.model,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    usdEstimate: 0
  };
  function addUsage(
    u:
      | {
          input_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
          output_tokens?: number;
        }
      | undefined
  ) {
    if (!u) return;
    meta.inputTokens += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    meta.cachedInputTokens += u.cache_read_input_tokens ?? 0;
    meta.outputTokens += u.output_tokens ?? 0;
  }

  // ─── First attempt ────────────────────────────────────────────────
  const first = await callOnce(messages);
  addUsage(first.usage);

  if (!first.parsed || typeof first.parsed !== 'object') {
    meta.usdEstimate = estimateUsd(meta, choice);
    return {
      scheduled: input.previousScheduled,
      rationale: input.previousRationale,
      advisories: input.previousAdvisories,
      reply:
        "I couldn't read the AI response cleanly — the schedule is unchanged. Try rephrasing your request.",
      windows,
      successionFits,
      meta: { ...meta, fallback: 'deterministic' }
    };
  }

  let validated = validateScheduleResponse(first.parsed, input, windowsByKey, successionFits);
  let lastParsed: unknown = first.parsed;
  let lastRawText = first.rawText;
  let lastReply =
    typeof (first.parsed as { reply?: unknown }).reply === 'string'
      ? (first.parsed as { reply: string }).reply.trim()
      : '';

  // ─── Corrective retry — mirrors the initial-schedule path. Echo the
  //     model's first reply, list the violations, ask for a surgical
  //     fix. Same prompt-engineering pattern that's already proven on
  //     the allocator + scheduler initial calls. ──────────────────────
  if (!validated.valid) {
    console.warn(
      `[aiSchedule.refine] first attempt failed validation (${validated.violations.length} violations); retrying.\n` +
        `Violations: ${validated.violations.slice(0, 6).join(' | ')}`
    );
    const correction =
      'Your previous response was rejected by the validator. Violations:\n' +
      validated.violations.map((v) => `- ${v}`).join('\n') +
      '\n\nReturn a CORRECTED schedule that fixes EVERY violation:' +
      '\n- Keep dates inside the per-row window ranges from the original prompt.' +
      '\n- Every assignment in the prompt must appear in scheduled[].' +
      '\n- Companion offsets must be recalculated from the anchor planting.' +
      '\n\nSame JSON shape as before — no prose, no code fences.';
    const retry = await callOnce([
      ...messages,
      { role: 'assistant', content: [{ type: 'text', text: first.rawText }] },
      { role: 'user', content: [{ type: 'text', text: correction }] }
    ]);
    addUsage(retry.usage);
    if (retry.parsed && typeof retry.parsed === 'object') {
      lastParsed = retry.parsed;
      lastRawText = retry.rawText;
      const retryReply =
        typeof (retry.parsed as { reply?: unknown }).reply === 'string'
          ? (retry.parsed as { reply: string }).reply.trim()
          : '';
      if (retryReply) lastReply = retryReply;
      validated = validateScheduleResponse(retry.parsed, input, windowsByKey, successionFits);
      if (!validated.valid) {
        console.warn(
          `[aiSchedule.refine] retry ALSO failed (${validated.violations.length} violations).`
        );
      }
    }
  }

  meta.usdEstimate = estimateUsd(meta, choice);
  void lastParsed;
  void lastRawText;

  if (!validated.valid) {
    return {
      scheduled: input.previousScheduled,
      rationale: input.previousRationale,
      advisories: input.previousAdvisories,
      reply:
        lastReply ||
        'I tried to apply that change but it would break the planting windows or staggers. The schedule is unchanged.',
      windows,
      successionFits,
      meta: { ...meta, fallback: 'deterministic', violations: validated.violations }
    };
  }
  const reply = lastReply;

  void options.planningSessionId;
  return {
    scheduled: validated.scheduled,
    rationale: validated.rationale || input.previousRationale,
    advisories: validated.advisories,
    reply: reply || 'Done — updated the dates above.',
    windows,
    successionFits,
    meta
  };
}

function buildScheduleRefinementUserMessage(message: string): string {
  return [
    'REFINEMENT TURN — the farmer has reviewed the proposed planting dates and wants to discuss changes.',
    '',
    'The candidacy windows, succession fits, and constraints from the original prompt still apply. Stay inside the per-assignment window; honor cross-pollination staggers; honor companion-group anchor+offset rules; honor succession spacing intervals.',
    '',
    'Respond with VALID JSON only — no markdown, no code fences:',
    '{',
    '  "reply": "1-3 plain-English sentences shown directly in the chat. Acknowledge what the farmer asked for and explain what you changed (or why you couldn\'t).",',
    '  "rationale": "2-4 sentence updated overview, or repeat the previous one if nothing material changed",',
    '  "scheduled": [ /* COMPLETE revised array, not a diff — one entry per dated planting, succession included */ ],',
    '  "advisories": ["0-4 short observations — empty array is fine"]',
    '}',
    '',
    'Hard rules:',
    '- Always return the COMPLETE revised scheduled array. Include every planting that should remain even if unchanged.',
    '- If the request would break a window or stagger, KEEP the previous schedule unchanged, set "reply" to a clear plain-English explanation, and note it in advisories.',
    '- Never echo column names, JSON, or raw ms timestamps into "reply".',
    '',
    `Farmer's message: ${message}`
  ].join('\n');
}

/** Top-level entry. Builds the candidacy + succession layers, prompts
 *  Claude with the constraints, parses + validates, falls back to a
 *  deterministic "plant at the earliest feasible date" plan when the AI
 *  is unavailable or invalid. */
export async function schedulePlantings(
  input: ScheduleInput,
  ctx: FarmContext,
  options: ScheduleOptions = {}
): Promise<ScheduleResult> {
  const windows = scheduleCandidacy({
    assignments: input.assignments,
    pluginIndex: input.pluginIndex,
    existingCrops: input.existingCrops,
    frostDates: input.frostDates,
    year: input.year
  });
  const windowsByKey = new Map<string, ScheduleWindow>();
  for (const w of windows) windowsByKey.set(`${w.stockItemId}:${w.blockId}`, w);

  const successionFits = windows.map((w) =>
    evaluateSuccessionFit(
      w,
      input.pluginIndex[
        input.assignments.find((a) => a.stockItemId === w.stockItemId && a.blockId === w.blockId)
          ?.cropPluginId ?? ''
      ],
      w.blockId,
      w.stockItemId
    )
  );

  const apiKey = getApiKey();
  // #210 — parity-log so allocate vs schedule divergence is visible. Both
  // endpoints route through `getApiKey()` (env-var first, settings second);
  // matching log lines make a mismatch trivial to spot.
  console.log(
    `[ai-schedule] apiKey present=${!!apiKey} envKey=${!!process.env.ANTHROPIC_API_KEY} settingsKey=${!!(apiKey && !process.env.ANTHROPIC_API_KEY)}`
  );
  if (!apiKey) {
    const det = buildDeterministicSchedule(input, windows, successionFits);
    return {
      scheduled: det,
      rationale:
        'No Anthropic API key configured — defaulted every planting to its earliest feasible date.',
      advisories: [],
      windows,
      successionFits,
      meta: {
        model: 'no-api-key',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        usdEstimate: 0,
        fallback: 'no-api-key'
      }
    };
  }

  const choice = selectModel('allocate');
  const client = new Anthropic({ apiKey });
  const systemBlocks = buildFarmSystemBlocks(ctx);

  // Pre-compute the deterministic plan and pass it as a baseline anchor in
  // the prompt. The deterministic scheduler already honors cross-pollination
  // staggers + companion offsets + succession spacing — by giving Claude a
  // known-valid plan, we get either a polished version (better rationale,
  // smarter spread) OR Claude echoes the baseline back. Either way the
  // validator passes. Without this anchor, Claude fails ~always on dense
  // cross-pollination constraint sets (e.g. 6 corn varieties).
  const baseline = buildDeterministicSchedule(input, windows, successionFits);
  const prompt = buildSchedulePrompt(input, windows, successionFits, baseline);

  const totalMeta: AiResultMeta = {
    model: choice.model,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    usdEstimate: 0
  };

  // First Claude call.
  const first = await callScheduleClaude(client, choice.model, systemBlocks, [
    { role: 'user', content: [{ type: 'text', text: prompt }] }
  ]);
  addScheduleMeta(totalMeta, first.meta, choice);

  let validated = first.parsed
    ? validateScheduleResponse(first.parsed, input, windowsByKey, successionFits)
    : null;
  let firstViolations: string[] | undefined;

  // Retry pass when the first response failed validation. Echo Claude's
  // previous answer + the violation list so it can patch surgically. Mirrors
  // the allocator's `retryWithSemanticContext` pattern.
  if (validated && !validated.valid) {
    firstViolations = validated.violations;
    console.warn(
      `[aiSchedule] first response failed validation (${validated.violations.length} violations); retrying.\n` +
        `Violations: ${validated.violations.slice(0, 6).join(' | ')}\n` +
        `Raw text (first 400): ${first.rawText.slice(0, 400)}`
    );
    const correction =
      'Your previous response was rejected by the validator. Violations:\n' +
      validated.violations.map((v) => `- ${v}`).join('\n') +
      '\n\nReturn a CORRECTED schedule. Keep what was already valid; change only what the violations require. Same JSON shape as before — no prose, no code fences.';
    const retry = await callScheduleClaude(client, choice.model, systemBlocks, [
      { role: 'user', content: [{ type: 'text', text: prompt }] },
      { role: 'assistant', content: [{ type: 'text', text: first.rawText }] },
      { role: 'user', content: [{ type: 'text', text: correction }] }
    ]);
    addScheduleMeta(totalMeta, retry.meta, choice);
    validated = retry.parsed
      ? validateScheduleResponse(retry.parsed, input, windowsByKey, successionFits)
      : null;
    if (validated && !validated.valid) {
      console.warn(
        `[aiSchedule] retry ALSO failed (${validated.violations.length} violations). Falling back to deterministic. ` +
          `Raw retry text (first 400): ${retry.rawText.slice(0, 400)}`
      );
    }
  } else if (first.parsed == null) {
    console.warn(
      `[aiSchedule] first response could not be parsed as JSON. Raw text (first 400): ${first.rawText.slice(0, 400)}`
    );
  }

  if (!validated || !validated.valid) {
    const det = buildDeterministicSchedule(input, windows, successionFits);
    const failedViolations = validated?.valid === false ? validated.violations : firstViolations;
    const diagnosis = diagnoseScheduleProblem(input, windows);
    return {
      scheduled: det,
      rationale:
        "AI scheduling output didn't validate (even after a corrective retry) — the deterministic scheduler took over. It honored cross-pollination staggers, companion offsets, and succession spacing where it could; review the dates and refine via chat if anything looks off.",
      advisories: [],
      windows,
      successionFits,
      meta: {
        ...totalMeta,
        fallback: 'deterministic',
        violations: failedViolations,
        diagnosis
      }
    };
  }

  void options.planningSessionId;
  return {
    scheduled: validated.scheduled,
    rationale: validated.rationale,
    advisories: validated.advisories,
    windows,
    successionFits,
    meta: totalMeta
  };
}

interface ScheduleClaudeCall {
  parsed: unknown;
  rawText: string;
  meta: {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  };
}

async function callScheduleClaude(
  client: Anthropic,
  model: string,
  systemBlocks: { type: 'text'; text: string; cache_control: { type: 'ephemeral' } }[],
  messages: Array<{ role: 'user' | 'assistant'; content: { type: 'text'; text: string }[] }>
): Promise<ScheduleClaudeCall> {
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: systemBlocks,
      messages
    });
    const usage = (msg.usage as unknown as Record<string, number | undefined>) ?? {};
    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
    const parsed = extractJsonObject(text);
    if (parsed === null && text.length > 0) {
      const preview = text.length > 800 ? `${text.slice(0, 800)}…` : text;
      console.warn(
        '[aiSchedule] could not extract JSON from model response. Raw text:\n' + preview
      );
    }
    return {
      parsed,
      rawText: text,
      meta: {
        input_tokens: usage.input_tokens ?? 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0
      }
    };
  } catch (err) {
    console.warn(
      `[aiSchedule] Anthropic call failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return {
      parsed: null,
      rawText: '',
      meta: {
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0
      }
    };
  }
}

/**
 * Diagnose why a schedule failed in plain English. Looks at the assignment
 * list grouped by crop family, computes the calendar pressure (required
 * stagger spread vs available window), and produces concrete named
 * suggestions — "Drop one of: <variety1>, <variety2>, …" — rather than
 * a list of validator strings.
 *
 * Called when both Claude attempts fail validation and we fall back to the
 * deterministic plan. The result rides on `meta.diagnosis` and the chat
 * seed uses it as the operator-facing explanation.
 */
export function diagnoseScheduleProblem(
  input: ScheduleInput,
  windows: ScheduleWindow[]
): ScheduleDiagnosis {
  const windowsByKey = new Map<string, ScheduleWindow>();
  for (const w of windows) windowsByKey.set(`${w.stockItemId}:${w.blockId}`, w);

  // Group assignments by crop family. For each family, gather the varieties
  // present and compute the calendar pressure if they cross-pollinate.
  const familyAssignments = new Map<string, ScheduleAssignmentInput[]>();
  for (const a of input.assignments) {
    const plug = input.pluginIndex[a.cropPluginId];
    const family = plug?.cropFamily ?? 'unknown';
    const list = familyAssignments.get(family) ?? [];
    list.push(a);
    familyAssignments.set(family, list);
  }

  // Find the cross-pollination stagger requirement per family (max across
  // must-stagger constraints involving members of that family).
  const familyStaggerDays = new Map<string, number>();
  for (const p of input.pollinationConstraints) {
    if (p.kind !== 'must-stagger') continue;
    const plugA =
      input.pluginIndex[
        input.assignments.find((a) => a.stockItemId === p.pair[0])?.cropPluginId ?? ''
      ];
    const plugB =
      input.pluginIndex[
        input.assignments.find((a) => a.stockItemId === p.pair[1])?.cropPluginId ?? ''
      ];
    for (const plug of [plugA, plugB]) {
      if (!plug) continue;
      const cur = familyStaggerDays.get(plug.cropFamily) ?? 0;
      familyStaggerDays.set(plug.cropFamily, Math.max(cur, p.staggerDays));
    }
  }

  const suggestions: string[] = [];
  const pressureSummaries: string[] = [];

  for (const [family, assignments] of familyAssignments) {
    const staggerDays = familyStaggerDays.get(family);
    if (!staggerDays || assignments.length < 2) continue;
    // Required calendar span = (N-1) × stagger days; minimum to satisfy all
    // pairwise gaps when laid out linearly.
    const required = (assignments.length - 1) * staggerDays;
    // Available window = the union span of every assignment's window for
    // this family. We take the tightest "latest" and the latest "earliest"
    // so the union is the intersection-style window every variety can hit.
    let earliest = Infinity;
    let latest = -Infinity;
    for (const a of assignments) {
      const w = windowsByKey.get(`${a.stockItemId}:${a.blockId}`);
      if (!w) continue;
      if (w.earliestMs < earliest) earliest = w.earliestMs;
      if (w.latestMs > latest) latest = w.latestMs;
    }
    if (!Number.isFinite(earliest) || !Number.isFinite(latest)) continue;
    const available = Math.max(0, Math.round((latest - earliest) / 86_400_000));
    if (available <= 0) continue;
    const pressureRatio = required / available;
    if (pressureRatio < 0.8) continue; // Comfortable fit, skip.

    const varietyNames = assignments.map((a) => a.varietyDisplayName).sort();
    const overflow = required - available;
    const phrase =
      pressureRatio >= 1
        ? `${varietyNames.length} ${family} varieties on this farm all cross-pollinate. They need at least ${staggerDays} days between plantings to stay pure, which adds up to ${required} days of planting calendar — but the ${family} planting window is only ${available} days long. That's ${overflow} more days of stagger than the window can hold.`
        : `${varietyNames.length} ${family} varieties on this farm all cross-pollinate. They need at least ${staggerDays} days between plantings (${required} days total) and the ${family} window is only ${available} days. It's possible but extremely tight — any succession plantings or weather slack pushes it past feasible.`;
    pressureSummaries.push(phrase);

    // Suggest dropping the smallest-quantity variety since it's the lowest-
    // cost decision (less seed wasted) and frees a full stagger interval.
    const byPlants = [...assignments].sort((a, b) => a.plants - b.plants);
    const smallest = byPlants[0];
    suggestions.push(
      `Drop **${smallest.varietyDisplayName}** — it's the smallest ${family} planting (${smallest.plants} plants) and removing it frees ${staggerDays} days of calendar.`
    );
    if (assignments.length >= 4) {
      const namesPreview = varietyNames.slice(0, 3).join(', ');
      const more = varietyNames.length > 3 ? `, …or one of ${varietyNames.length - 3} others` : '';
      suggestions.push(
        `Or drop a different ${family} variety entirely — candidates: ${namesPreview}${more}. Each one removed frees ${staggerDays} days.`
      );
    }
    suggestions.push(
      `Skip succession plantings on ${family} — multiple varieties already give you a staggered harvest naturally. Frees ~${staggerDays} days per skipped succession.`
    );
    if (assignments.length >= 3) {
      suggestions.push(
        `Plant ${family} as a rotation: keep ${Math.ceil(assignments.length / 2)} this year, ${Math.floor(assignments.length / 2)} next year. Halves the stagger pressure and improves soil health.`
      );
    }
  }

  if (pressureSummaries.length === 0) {
    // No family-level pressure detected — failure was likely on companion
    // offsets, succession spacing, or plant-total rounding. Give a generic
    // but still-actionable summary.
    return {
      summary:
        "I couldn't fit your schedule cleanly, but it wasn't a single big constraint — looks like a mix of small issues with how the dates aligned. The deterministic plan above should be close to right.",
      suggestions: [
        'Try the dates above as-is and adjust individual rows by chatting (e.g., "push the brassicas two weeks later").',
        'Or click **Re-schedule** to ask the AI to try again with fresh randomness.'
      ]
    };
  }

  return {
    summary: pressureSummaries.join(' '),
    suggestions: [
      ...suggestions,
      'Accept the dates above — the deterministic plan got everything in, just with some tight gaps.'
    ]
  };
}

function addScheduleMeta(
  total: AiResultMeta,
  call: {
    input_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    output_tokens: number;
  },
  choice: Parameters<typeof estimateUsd>[1]
): void {
  total.inputTokens += call.input_tokens + call.cache_creation_input_tokens;
  total.cachedInputTokens += call.cache_read_input_tokens;
  total.outputTokens += call.output_tokens;
  total.usdEstimate = estimateUsd(total, choice);
}

// ─── Prompt building ─────────────────────────────────────────────────────

function buildSchedulePrompt(
  input: ScheduleInput,
  windows: ScheduleWindow[],
  successionFits: SuccessionFit[],
  baseline?: ScheduledPlanting[]
): string {
  const blockNameOf = (id: string) => id;
  const stockNameOf = (id: string) =>
    input.assignments.find((a) => a.stockItemId === id)?.varietyDisplayName ?? id;

  const assignmentLines = input.assignments.map((a) => {
    const w = windows.find((x) => x.stockItemId === a.stockItemId && x.blockId === a.blockId);
    const fit = successionFits.find(
      (x) => x.stockItemId === a.stockItemId && x.blockId === a.blockId
    );
    const earliest = w ? formatDateMs(w.earliestMs) : '?';
    const latest = w ? formatDateMs(w.latestMs) : '?';
    const hardiness = w?.hardiness ?? '?';
    const succ =
      fit && fit.eligible
        ? ` | succession: UP TO ${fit.maxPlantings} plantings @ ${fit.suggestedIntervalDays}d apart (${fit.reason})`
        : fit
          ? ` | succession: single planting (${fit.reason})`
          : '';
    return `- ${a.stockItemId} on ${a.blockId} | ${stockNameOf(a.stockItemId)} | plants=${a.plants} | window=${earliest}..${latest} | hardiness=${hardiness}${succ}`;
  });

  const pollinationLines = input.pollinationConstraints
    .filter((p) => p.kind === 'must-stagger')
    .map(
      (p) =>
        `- ${p.pair[0]} (${p.pairDisplayNames[0]}) on ${p.blockIds[0]} ⟷ ${p.pair[1]} (${p.pairDisplayNames[1]}) on ${p.blockIds[1]}: ` +
        `stagger ≥${p.staggerDays} d between their planting dates (silking windows can't overlap).`
    );

  const companionLines = input.companionGroups.flatMap((g) => {
    const anchor = anchorStockInGroup(g);
    if (!anchor) return [];
    const lines: string[] = [
      `- Group ${g.groupId} (${g.anchorFamily} anchor=${stockNameOf(anchor)}): plant the anchor on its chosen date, then each companion N days after.`
    ];
    for (const m of g.members) {
      if (m.role === 'anchor') continue;
      lines.push(
        `    ${m.stockItemId} (${stockNameOf(m.stockItemId)}) = anchor + ${m.daysFromAnchor} d`
      );
    }
    return lines;
  });

  // Pre-computed deterministic baseline that already honors every hard
  // constraint (windows, staggers, companion offsets, succession spacing).
  // Claude can echo it back verbatim OR improve it; either way the validator
  // passes. This was added because dense constraint sets (e.g. 6 corn
  // varieties with 16 must-stagger pairs in a 75-day window) caused even
  // careful Claude responses to drift on one rounding edge, triggering
  // outright validator rejection. With this anchor the failure mode shifts
  // from "no plan" to "AI's plan polished or unchanged."
  const baselineLines = (baseline ?? []).map((p) => {
    const idxStr = p.successionIndex ? ` (${p.successionIndex.i}/${p.successionIndex.n})` : '';
    return `- ${p.stockItemId} on ${p.blockId}${idxStr}: ${formatDateMs(p.plantingDateMs)} | ${p.plants} plants`;
  });

  const hasDenseStagger = pollinationLines.length >= 6;

  return [
    'You are scheduling planting dates for an already-finalized seed-to-block allocation. The farmer locked the spatial layout; your job is to pick dates that honor every constraint below.',
    '',
    'ASSIGNMENTS (one row each — these are fixed; do NOT change blockId, stockItemId, or plants total):',
    ...assignmentLines,
    '',
    'CONSTRAINTS:',
    pollinationLines.length > 0
      ? 'CROSS-POLLINATION TEMPORAL STAGGERS (the allocator could not isolate these spatially — you MUST enforce the stagger):'
      : 'CROSS-POLLINATION: none open (spatially isolated or N/A).',
    ...pollinationLines,
    '',
    companionLines.length > 0
      ? 'COMPANION GROUPS (anchor + offset; use these EXACT day offsets):'
      : 'COMPANION GROUPS: none detected.',
    ...companionLines,
    '',
    ...(baselineLines.length > 0
      ? [
          'BASELINE PLAN (already satisfies every constraint above — use as a starting point):',
          ...baselineLines,
          '',
          'You may echo this baseline back unchanged, or refine it for better rationale / smarter date spreads. If you keep a date, keep the plants count too. If you reduce or expand successions, sum-of-plants per assignment must still equal the original (within ±max(3, 1% of total)).',
          ''
        ]
      : []),
    'RULES:',
    "- Every dated planting must fall within the assignment's window (earliest..latest).",
    '- Tender crops: prefer 7-10 days after the last-frost mark, BUT when many must-stagger pairs apply (see CROSS-POLLINATION above), USE THE FULL WINDOW — pack early-clustered dates will violate the staggers and produce an unschedulable plan.',
    '- Hardy crops: planting earlier is normally better unless the block is occupied.',
    '- For cross-pollination stagger pairs, the calendar gap between the two pickings must be ≥ the listed days. With N crossing varieties, you need at minimum (N-1) × stagger_days of total spread; spread them evenly across the window when possible.',
    hasDenseStagger
      ? '- This farm has DENSE cross-pollination constraints (' +
        pollinationLines.length +
        ' must-stagger pairs). DO NOT split assignments into successions unless absolutely necessary — successions consume window space and compound the stagger problem. Single-planting per (seed, block) is the right default here.'
      : '- When succession is eligible AND the operator clearly benefits (long DTM window, fast-growing crop), split the assignment into multiple dated plantings — return one record per planting, with `successionIndex: {i, n}` and the plants summed correctly across rows. When in doubt, keep it as a single planting (over-splitting frustrates field operations).',
    '- For companion groups, the anchor and companions all share the same blockId by construction; just apply the day offsets to the chosen anchor date.',
    '',
    'Respond with VALID JSON only — no markdown, no commentary outside the JSON. Schema:',
    '{',
    '  "rationale": "2-4 sentence plain-English overview of the scheduling strategy",',
    '  "scheduled": [',
    '    { "stockItemId": "...", "blockId": "...", "plantingDate": "YYYY-MM-DD", "plants": <int>, "successionIndex": { "i": 1, "n": 3 } | null, "rationale": "1 plain-English sentence" }',
    '  ],',
    '  "advisories": ["short observation", "another short observation"]',
    '}',
    '',
    'When a single planting is chosen, omit `successionIndex` or set it to null.'
  ].join('\n');
}

// ─── Validation ──────────────────────────────────────────────────────────

interface ValidatedSchedule {
  valid: true;
  scheduled: ScheduledPlanting[];
  rationale: string;
  advisories: string[];
}
interface InvalidSchedule {
  valid: false;
  violations: string[];
}

function validateScheduleResponse(
  raw: unknown,
  input: ScheduleInput,
  windowsByKey: Map<string, ScheduleWindow>,
  successionFits: SuccessionFit[]
): ValidatedSchedule | InvalidSchedule {
  const violations: string[] = [];
  if (!raw || typeof raw !== 'object')
    return { valid: false, violations: ['response was not an object'] };
  const obj = raw as { scheduled?: unknown; rationale?: unknown; advisories?: unknown };
  if (!Array.isArray(obj.scheduled))
    return { valid: false, violations: ['scheduled must be an array'] };

  const assignByKey = new Map<string, ScheduleAssignmentInput>();
  for (const a of input.assignments) assignByKey.set(`${a.stockItemId}:${a.blockId}`, a);

  const fitByKey = new Map<string, SuccessionFit>();
  for (const f of successionFits) fitByKey.set(`${f.stockItemId}:${f.blockId}`, f);

  const scheduled: ScheduledPlanting[] = [];
  const plantsByKey = new Map<string, number>();
  const dateByStockItem = new Map<string, number[]>();

  for (let i = 0; i < obj.scheduled.length; i++) {
    const r = obj.scheduled[i] as Record<string, unknown> | undefined;
    if (!r || typeof r !== 'object') {
      violations.push(`scheduled[${i}] is not an object`);
      continue;
    }
    if (typeof r.stockItemId !== 'string' || typeof r.blockId !== 'string') {
      violations.push(`scheduled[${i}] missing stockItemId or blockId`);
      continue;
    }
    if (typeof r.plantingDate !== 'string') {
      violations.push(`scheduled[${i}] missing plantingDate (YYYY-MM-DD)`);
      continue;
    }
    if (typeof r.plants !== 'number' || !Number.isFinite(r.plants) || r.plants <= 0) {
      violations.push(`scheduled[${i}] plants must be positive`);
      continue;
    }
    const key = `${r.stockItemId}:${r.blockId}`;
    const assignment = assignByKey.get(key);
    if (!assignment) {
      violations.push(`scheduled[${i}] references unknown assignment ${key}`);
      continue;
    }
    const window = windowsByKey.get(key);
    if (!window) {
      violations.push(`scheduled[${i}] no candidacy window for ${key}`);
      continue;
    }
    const ms = Date.parse(r.plantingDate);
    if (!Number.isFinite(ms)) {
      violations.push(`scheduled[${i}] plantingDate "${r.plantingDate}" did not parse`);
      continue;
    }
    if (ms < window.earliestMs - ONE_DAY_MS || ms > window.latestMs + ONE_DAY_MS) {
      violations.push(
        `scheduled[${i}] plantingDate ${r.plantingDate} outside window ${formatDateMs(window.earliestMs)}..${formatDateMs(window.latestMs)}`
      );
      continue;
    }
    let successionIndex: ScheduledPlanting['successionIndex'];
    if (r.successionIndex && typeof r.successionIndex === 'object') {
      const si = r.successionIndex as { i?: unknown; n?: unknown };
      if (
        typeof si.i === 'number' &&
        typeof si.n === 'number' &&
        si.n >= 1 &&
        si.i >= 1 &&
        si.i <= si.n
      ) {
        successionIndex = { i: Math.floor(si.i), n: Math.floor(si.n) };
      }
    }

    scheduled.push({
      stockItemId: r.stockItemId,
      blockId: r.blockId,
      cropPluginId: assignment.cropPluginId,
      varietyDisplayName: assignment.varietyDisplayName,
      plantingDateMs: ms,
      plants: Math.floor(r.plants),
      successionIndex,
      rationale: typeof r.rationale === 'string' ? r.rationale : ''
    });
    plantsByKey.set(key, (plantsByKey.get(key) ?? 0) + Math.floor(r.plants));
    const dates = dateByStockItem.get(r.stockItemId) ?? [];
    dates.push(ms);
    dateByStockItem.set(r.stockItemId, dates);
  }

  for (const [key, assignment] of assignByKey) {
    const total = plantsByKey.get(key) ?? 0;
    if (total === 0) {
      violations.push(
        `no scheduled planting for assignment ${key} (${assignment.varietyDisplayName})`
      );
      continue;
    }
    // Plant-total tolerance: ±max(3, 1% of total). Tight check was rejecting
    // Claude's normal rounding (e.g., 638 → 213/213/212 = 638 fine, but
    // 1700 → 425/425/425/426 = 1701 drift of 1 ok; some splits drift more).
    const plantTolerance = Math.max(3, Math.ceil(assignment.plants * 0.01));
    if (Math.abs(total - assignment.plants) > plantTolerance) {
      violations.push(
        `assignment ${key} plants mismatch — scheduled sum=${total}, expected=${assignment.plants} (±${plantTolerance})`
      );
    }
    const fit = fitByKey.get(key);
    // Succession-spacing tolerance: 2-day slack so a "14 d apart" gap of 12d
    // (Claude rounded to the prior week's planting day) still passes.
    const dates = (dateByStockItem.get(assignment.stockItemId) ?? []).slice().sort((a, b) => a - b);
    if (fit && dates.length >= 2) {
      const minGap = fit.suggestedIntervalDays * ONE_DAY_MS;
      for (let i = 1; i < dates.length; i++) {
        if (dates[i] - dates[i - 1] < minGap - 2 * ONE_DAY_MS) {
          violations.push(
            `succession plantings for ${assignment.varietyDisplayName} are only ${Math.round((dates[i] - dates[i - 1]) / ONE_DAY_MS)} d apart, expected ≥${fit.suggestedIntervalDays} d`
          );
          break;
        }
      }
    }
  }

  // Cross-pollination stagger enforcement — 2-day slack: a "14 d apart"
  // requirement passes at 12 d (Claude's "round to Mondays" behaviour).
  for (const p of input.pollinationConstraints) {
    if (p.kind !== 'must-stagger') continue;
    const datesA = dateByStockItem.get(p.pair[0]) ?? [];
    const datesB = dateByStockItem.get(p.pair[1]) ?? [];
    if (datesA.length === 0 || datesB.length === 0) continue;
    let bestGap = Infinity;
    for (const a of datesA) for (const b of datesB) bestGap = Math.min(bestGap, Math.abs(a - b));
    if (bestGap < p.staggerDays * ONE_DAY_MS - 2 * ONE_DAY_MS) {
      violations.push(
        `pollination stagger violated: ${p.pairDisplayNames[0]} & ${p.pairDisplayNames[1]} are only ${Math.round(bestGap / ONE_DAY_MS)} d apart, expected ≥${p.staggerDays} d`
      );
    }
  }

  // Companion-group offset enforcement — keep at ±3d (already lenient enough
  // and tighter than the pollination check on purpose: companions are
  // sequenced by design, drift past a few days breaks the agronomy).
  for (const g of input.companionGroups) {
    const anchor = anchorStockInGroup(g);
    if (!anchor) continue;
    const anchorDates = dateByStockItem.get(anchor) ?? [];
    if (anchorDates.length === 0) continue;
    const anchorMs = anchorDates[0];
    for (const m of g.members) {
      if (m.role === 'anchor') continue;
      const dates = dateByStockItem.get(m.stockItemId) ?? [];
      if (dates.length === 0) continue;
      const expected = anchorMs + (offsetForStockInGroup(g, m.stockItemId) ?? 0) * ONE_DAY_MS;
      const drift = Math.abs(dates[0] - expected);
      if (drift > 3 * ONE_DAY_MS) {
        violations.push(
          `companion group ${g.groupId}: ${m.stockItemId} should plant ~${formatDateMs(expected)} (anchor+${m.daysFromAnchor}d) but scheduled ${formatDateMs(dates[0])}`
        );
      }
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
  return { valid: true, scheduled, rationale, advisories };
}

// ─── Deterministic fallback ──────────────────────────────────────────────

/**
 * Greedy deterministic scheduler used when the AI is unavailable or its
 * output fails validation. Walks assignments in (anchors-first, then
 * earliest-date) order, and for each one bumps the chosen date forward
 * past every must-stagger conflict with already-placed partner varieties.
 * Companion-group members are anchored to their group's anchor date plus
 * the registered offset. Succession-eligible assignments produce N rows
 * spaced by `suggestedIntervalDays`.
 *
 * This is a backstop, not a planner — when conflicts force a date past the
 * assignment's `latestMs`, we clamp to `latestMs` and accept some
 * sub-optimality rather than refusing to plan. The schedule chat is then
 * the path to refine.
 */
export function buildDeterministicSchedule(
  input: ScheduleInput,
  windows: ScheduleWindow[],
  fits: SuccessionFit[]
): ScheduledPlanting[] {
  const windowsByKey = new Map<string, ScheduleWindow>();
  for (const w of windows) windowsByKey.set(`${w.stockItemId}:${w.blockId}`, w);
  const fitByKey = new Map<string, SuccessionFit>();
  for (const f of fits) fitByKey.set(`${f.stockItemId}:${f.blockId}`, f);

  // Pre-compute reverse partner map for must-stagger constraints.
  const partnersOf = new Map<string, Array<{ partner: string; staggerDays: number }>>();
  for (const p of input.pollinationConstraints) {
    if (p.kind !== 'must-stagger') continue;
    const [a, b] = p.pair;
    const al = partnersOf.get(a) ?? [];
    al.push({ partner: b, staggerDays: p.staggerDays });
    partnersOf.set(a, al);
    const bl = partnersOf.get(b) ?? [];
    bl.push({ partner: a, staggerDays: p.staggerDays });
    partnersOf.set(b, bl);
  }

  // Set of stockItemIds that are anchors of a companion group — anchors are
  // processed first so companions can offset off their committed date.
  const anchors = new Set<string>();
  for (const g of input.companionGroups) {
    const anchor = anchorStockInGroup(g);
    if (anchor) anchors.add(anchor);
  }

  // Sort: anchors first, then earliest-window first, ties broken by stockItemId.
  const sorted = [...input.assignments].sort((a, b) => {
    const aA = anchors.has(a.stockItemId) ? 0 : 1;
    const bA = anchors.has(b.stockItemId) ? 0 : 1;
    if (aA !== bA) return aA - bA;
    const wa = windowsByKey.get(`${a.stockItemId}:${a.blockId}`);
    const wb = windowsByKey.get(`${b.stockItemId}:${b.blockId}`);
    const ea = wa?.earliestMs ?? 0;
    const eb = wb?.earliestMs ?? 0;
    if (ea !== eb) return ea - eb;
    return a.stockItemId.localeCompare(b.stockItemId);
  });

  const datesByStock = new Map<string, number[]>();
  const out: ScheduledPlanting[] = [];

  for (const a of sorted) {
    const key = `${a.stockItemId}:${a.blockId}`;
    const w = windowsByKey.get(key);
    if (!w) continue;
    const fit = fitByKey.get(key);

    // Companion-group inheritance: if this assignment is a non-anchor
    // member, lock to anchor_date + offset.
    let companionForcedDate: number | null = null;
    for (const g of input.companionGroups) {
      const member = g.members.find((m) => m.stockItemId === a.stockItemId);
      if (!member || member.role === 'anchor') continue;
      const anchor = anchorStockInGroup(g);
      if (!anchor) continue;
      const anchorDates = datesByStock.get(anchor) ?? [];
      if (anchorDates.length === 0) continue;
      companionForcedDate = anchorDates[0] + member.daysFromAnchor * ONE_DAY_MS;
      break;
    }

    let baseDate = companionForcedDate ?? w.earliestMs;
    const partners = partnersOf.get(a.stockItemId) ?? [];

    // Greedy stagger-clearance: bump forward until no partner date conflicts.
    // Bounded to 60 iterations so a pathological constraint set can't loop.
    for (let attempt = 0; attempt < 60; attempt++) {
      let conflict: { otherDate: number; staggerMs: number } | null = null;
      for (const p of partners) {
        const stagger = p.staggerDays * ONE_DAY_MS;
        const otherDates = datesByStock.get(p.partner) ?? [];
        for (const od of otherDates) {
          if (Math.abs(baseDate - od) < stagger - ONE_DAY_MS / 2) {
            conflict = { otherDate: od, staggerMs: stagger };
            break;
          }
        }
        if (conflict) break;
      }
      if (!conflict) break;
      baseDate = conflict.otherDate + conflict.staggerMs;
    }

    // Clamp to the candidacy window. When stagger pressure pushes past
    // the latest viable date, we accept the clamp and flag in rationale.
    let clamped = false;
    if (baseDate > w.latestMs) {
      baseDate = w.latestMs;
      clamped = true;
    }
    if (baseDate < w.earliestMs) baseDate = w.earliestMs;

    const isSuccession = !!(fit && fit.eligible && fit.maxPlantings >= 2);
    const n = isSuccession ? Math.min(fit!.maxPlantings, 4) : 1;
    const intervalMs = isSuccession ? fit!.suggestedIntervalDays * ONE_DAY_MS : 0;
    const split = splitQuantityForSuccession(a.plants, n);

    const placedDates: number[] = [];
    for (let i = 0; i < n; i++) {
      let date = baseDate + i * intervalMs;
      // Successive plantings can spill past latestMs — clamp to keep them
      // sortable, but the validator on a chat refinement will catch it.
      if (date > w.latestMs) date = w.latestMs;
      placedDates.push(date);
      let rationale: string;
      if (i === 0) {
        if (companionForcedDate != null) {
          const group = input.companionGroups.find((g) =>
            g.members.some((m) => m.stockItemId === a.stockItemId)
          );
          const member = group?.members.find((m) => m.stockItemId === a.stockItemId);
          rationale = `Anchored to companion group (anchor + ${member?.daysFromAnchor ?? 0} d).`;
        } else if (partners.length > 0 && baseDate > w.earliestMs) {
          rationale = `Bumped forward from ${formatDateMs(w.earliestMs)} to clear cross-pollination staggers.`;
        } else if (clamped) {
          rationale = `Clamped to latest viable date — staggers couldn't fit cleanly. Refine via chat.`;
        } else {
          rationale = isSuccession
            ? `First of ${n} successions — earliest feasible date.`
            : `Earliest feasible planting date for this block + variety.`;
        }
      } else {
        rationale = `Succession ${i + 1} of ${n}, ${fit!.suggestedIntervalDays} d after the prior.`;
      }
      out.push({
        stockItemId: a.stockItemId,
        blockId: a.blockId,
        cropPluginId: a.cropPluginId,
        varietyDisplayName: a.varietyDisplayName,
        plantingDateMs: date,
        plants: split[i],
        successionIndex: isSuccession ? { i: i + 1, n } : undefined,
        rationale
      });
    }
    datesByStock.set(a.stockItemId, [...(datesByStock.get(a.stockItemId) ?? []), ...placedDates]);
  }
  return out;
}
