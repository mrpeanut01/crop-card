/**
 * AI group planning (Phase 15b — UC-38 v2).
 *
 * Mirrors the aiAllocation pattern: a deterministic engine pre-computes a
 * candidacy matrix of plausible plans (groups + singletons) per block,
 * Claude picks which to propose with rationale + dates, output is validated
 * against the matrix, and on AI failure the engine's deterministic plan is
 * returned with a `fallback` flag so the UI can warn.
 *
 * The engine never invents companion offsets — it reads them from
 * `lib/calendar/companions.ts` SYSTEMS, the same source-of-truth UC-07 uses.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { CropPlugin } from '$lib/plugins/schemas';
import type { CropFamily } from '$lib/safety/cropFamilyLethality';
import type { Crop } from '$lib/db/crops';
import type { BlockWithPlantings } from '$lib/db/blocks';
import {
  buildFarmSystemBlocks,
  estimateUsd,
  selectModel,
  type AiResultMeta,
  type FarmContext
} from './aiPlanning';
import { recordAiCall } from './aiCallStats';
import { getDerivedSignal, setDerivedSignal } from './aiDerivedSignals';
import { appendTurn, buildThreadedMessages } from './aiPlanningSession';
import { getApiKey } from './scanResult';

const MAX_OUTPUT_TOKENS = 4000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Static companion systems (mirror lib/calendar/companions.ts) ────────
//
// We keep this module decoupled from the calendar package by re-declaring
// the table here in the shape the engine + AI need. If a new system is
// added in companions.ts, mirror it below.

interface CompanionSystem {
  name: string;
  benefit: string;
  primaryFamily: CropFamily;
  members: ReadonlyArray<{
    family: CropFamily;
    role: string;
    plantingOffsetDays: number;
  }>;
}

const SYSTEMS: ReadonlyArray<CompanionSystem> = [
  {
    name: 'Three Sisters',
    benefit:
      'Beans fix nitrogen + climb cornstalks; squash/pumpkin vines suppress weeds at the ground layer.',
    primaryFamily: 'corn',
    members: [
      { family: 'legume', role: 'trellis + n-fixer', plantingOffsetDays: 14 },
      { family: 'cucurbit', role: 'ground-cover', plantingOffsetDays: 35 }
    ]
  }
];

// ─── Public types ────────────────────────────────────────────────────────

export interface GroupPlanningInput {
  /** Drafts = active or planned crops the operator has attached to a block
   *  but not yet scheduled (or already scheduled but eligible for grouping). */
  drafts: ReadonlyArray<Crop>;
  blocks: ReadonlyArray<BlockWithPlantings>;
  pluginIndex: Record<string, CropPlugin>;
  /** Earliest viable plant date per crop, derived from soil-temp normals. */
  soilTempEarliestByCrop: Record<string, number | null>;
  lastSpringFrostMs: number;
  firstFallFrostMs: number;
  year: number;
  /**
   * Phase 15e — per-draft spatial density signal so the Group AI can flag
   * over-packed blocks before scheduling. Computed by the caller from the
   * sufficiency module + plugin plantingGuide. Indexed by Crop.id (draft).
   *
   * When omitted (e.g., older callers), the AI falls back to its current
   * date-only behaviour and density rules become advisory rather than
   * actionable.
   */
  densityByDraft?: Record<
    string,
    {
      /** sqft this single plant claims at maturity (max of row spacing vs
       *  vine spread). */
      footprintSqFt: number;
      /** Mature vine/canopy spread in feet (max of vineSpreadFt range), or
       *  null when the plugin has no spread data. Vining cultivars >=10 ft
       *  often need solo placement on small blocks. */
      vineSpreadFt: number | null;
      /** Plants the operator has seed for (from stock). null if not tracked. */
      plantsAvailable: number | null;
      /** Plants the assigned block can fit at the crop's footprint. */
      plantsFit: number | null;
      /** Combined utilization: plantsAvailable / plantsFit on this draft's
       *  block. > 1.25 = badly over-packed, > 1.0 = surplus. */
      utilizationPct: number | null;
    }
  >;
}

export type ProposedPlan =
  | {
      kind: 'group';
      systemKind: 'three-sisters';
      blockId: string;
      anchor: PlanMember;
      companions: PlanMember[];
      rationale: string;
      advisories: string[];
    }
  | {
      kind: 'singleton';
      systemKind: 'singleton';
      blockId: string;
      anchor: PlanMember;
      rationale: string;
      advisories: string[];
    };

export interface PlanMember {
  cropId: string;
  cropPluginId: string;
  varietyDisplayName: string;
  cropFamily: string;
  /** Days from the anchor's plantingDate; 0 on the anchor + singleton. */
  offsetDays: number;
  /** Resolved planting date in ms. */
  plantingDateMs: number;
}

export interface MatrixCandidate {
  /** Stable id used in the prompt + AI response. */
  id: string;
  kind: 'group' | 'singleton';
  systemName?: string;
  systemKind: 'three-sisters' | 'singleton';
  blockId: string;
  /** Crop ids of every member, anchor first. */
  memberCropIds: string[];
  /** Earliest viable anchor plant date (ms) given soil-temp + frost. */
  earliestAnchorMs: number;
  /** Latest viable anchor plant date (ms) so the latest member still
   *  matures before first frost. May be < earliestAnchorMs when the window
   *  closes — those candidates are dropped. */
  latestAnchorMs: number;
  /** Recommended anchor date — engine's "best" pick used as a default
   *  when the AI doesn't specify or fails. */
  recommendedAnchorMs: number;
}

export interface GroupPlanningResult {
  proposed: ProposedPlan[];
  /** Drafts that didn't end up in any plan. `kind` distinguishes:
   *   - 'window-conflict': engine couldn't fit it into a viable date window
   *   - 'density-displaced': AI deliberately dropped it because the block
   *      is over-packed (combined family density, vine spread, etc.) and
   *      recommends moving or removing this draft. */
  unscheduled: Array<{
    cropId: string;
    reason: string;
    kind: 'window-conflict' | 'density-displaced';
  }>;
  meta: AiResultMeta & { fallback?: 'engine-only' | 'no-api-key' };
}

export interface GroupPlanningOptions {
  /** Phase 17 (Track 3.4) — when supplied, the Anthropic call threads prior
   *  planning-session turns and the response is appended back for downstream
   *  endpoints to see. */
  planningSessionId?: string;
  /** Phase 17 (Track 3.5) — pass-through from the caller's farm-context
   *  cache lookup; used only for telemetry attribution. */
  contextCacheHit?: boolean;
  /** Phase 17 (Track 3.3) — stable hash of the farm state. Required for the
   *  derived-signal cache; when omitted, the matrix is recomputed every
   *  call (legacy behaviour). */
  contextVersion?: string;
}

// ─── Public API ──────────────────────────────────────────────────────────

export async function proposeGroupPlans(
  input: GroupPlanningInput,
  ctx: FarmContext,
  options: GroupPlanningOptions = {}
): Promise<GroupPlanningResult> {
  const matrixSubKey = hashInputsForMatrix(input);
  let derivedSignalHit = false;
  let matrix: MatrixCandidate[];
  if (options.contextVersion) {
    const cached = getDerivedSignal<MatrixCandidate[]>(
      options.contextVersion,
      'candidacy-matrix',
      matrixSubKey
    );
    if (cached) {
      matrix = cached;
      derivedSignalHit = true;
    } else {
      matrix = buildGroupCandidacyMatrix(input);
      setDerivedSignal(options.contextVersion, 'candidacy-matrix', matrix, matrixSubKey);
    }
  } else {
    matrix = buildGroupCandidacyMatrix(input);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return engineFallback(input, matrix, 'no-api-key');
  }

  const choice = selectModel('groups');
  const client = new Anthropic({ apiKey });
  // Phase 17 (Track 3.2) — dual cache breakpoints (header + bulky catalog).
  const systemBlocks = buildFarmSystemBlocks(ctx);

  const totalMeta: AiResultMeta = {
    model: choice.model,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    usdEstimate: 0
  };

  const firstPrompt = buildGroupPrompt(matrix, input);
  const telemetry: TelemetryConfig = {
    planningSessionId: options.planningSessionId,
    contextCacheHit: !!options.contextCacheHit,
    derivedSignalHit
  };
  let aiPlans: AiPlanRow[] | null = null;
  let displacedDrafts: AiDisplacedDraft[] = [];

  try {
    const first = await callClaude(client, choice.model, systemBlocks, firstPrompt, telemetry);
    addMeta(totalMeta, first.meta);
    const firstResponseText = stringifyForRetry(first.parsed);
    const validation = validateAiPlans(first.parsed, input, matrix);
    if (validation.valid) {
      aiPlans = validation.plans;
      displacedDrafts = validation.displacedDrafts;
    } else {
      // Phase 15e — multi-turn retry when the violations are semantic
      // (out-of-window, capacity-exceeded, displaced-conflict, etc.) so
      // Claude sees its own attempt and can amend rather than restart.
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
      const retryValidation = validateAiPlans(retry.parsed, input, matrix);
      if (retryValidation.valid) {
        aiPlans = retryValidation.plans;
        displacedDrafts = retryValidation.displacedDrafts;
      }
    }
  } catch {
    // Fall through to engine fallback.
  }

  if (!aiPlans) {
    const fallback = engineFallback(input, matrix, 'engine-only');
    fallback.meta = { ...fallback.meta, ...totalMeta, fallback: 'engine-only' };
    return fallback;
  }

  let proposed = materializeProposals(aiPlans, input, matrix);
  const displacedSet = new Set(displacedDrafts.map((d) => d.cropId));
  // Backfill: every attached draft should end up in SOME plan UNLESS the AI
  // explicitly displaced it for density reasons. Engine adds singletons for
  // anything else Claude dropped.
  proposed = backfillMissedDrafts(proposed, input, matrix, displacedSet);
  const unscheduled = computeUnscheduled(input.drafts, proposed, displacedDrafts);
  return { proposed, unscheduled, meta: totalMeta };
}

/** Phase 15d — deterministic engine-only path. Skips Claude entirely; the
 *  caller (e.g., the "Auto-schedule drafts" button) gets the same proposal
 *  shape but with `meta.fallback = 'engine-only'`. */
export function proposePlansEngineOnly(input: GroupPlanningInput): GroupPlanningResult {
  const matrix = buildGroupCandidacyMatrix(input);
  return engineFallback(input, matrix, 'engine-only');
}

// ─── Candidacy matrix ────────────────────────────────────────────────────

export function buildGroupCandidacyMatrix(input: GroupPlanningInput): MatrixCandidate[] {
  const out: MatrixCandidate[] = [];
  const draftsByBlock = groupBy(input.drafts, (d) => d.blockId);

  for (const block of input.blocks) {
    const drafts = draftsByBlock.get(block.id) ?? [];
    if (drafts.length === 0) continue;

    // 1. Group candidates: for each registered system whose primaryFamily
    //    has a draft on this block, check if every member family also has
    //    a draft on this block. If yes, propose the group.
    for (const system of SYSTEMS) {
      const anchorDrafts = drafts.filter(
        (d) => familyOf(d, input.pluginIndex) === system.primaryFamily
      );
      if (anchorDrafts.length === 0) continue;
      const memberCrops = system.members.map((m) => ({
        family: m.family,
        offsetDays: m.plantingOffsetDays,
        draft: drafts.find((d) => familyOf(d, input.pluginIndex) === m.family)
      }));
      if (memberCrops.some((m) => !m.draft)) continue;

      // For each viable anchor draft (typically one), produce a candidate.
      for (const anchor of anchorDrafts) {
        const memberCropIds = [anchor.id, ...memberCrops.map((m) => m.draft!.id)];
        const window = computeAnchorWindow(anchor, memberCrops, input);
        if (!window) continue;
        out.push({
          id: `g:${system.name}:${block.id}:${anchor.id}`,
          kind: 'group',
          systemName: system.name,
          systemKind: 'three-sisters',
          blockId: block.id,
          memberCropIds,
          ...window
        });
      }
    }

    // 2. Singleton candidates: every draft gets a singleton candidate too.
    //    AI may pick singleton over group when the group's member windows
    //    don't fit, or when the operator's intent is solo-planting.
    for (const d of drafts) {
      const window = computeAnchorWindow(d, [], input);
      if (!window) continue;
      out.push({
        id: `s:${block.id}:${d.id}`,
        kind: 'singleton',
        systemKind: 'singleton',
        blockId: block.id,
        memberCropIds: [d.id],
        ...window
      });
    }
  }

  return out;
}

function familyOf(draft: Crop, idx: Record<string, CropPlugin>): string | null {
  return idx[draft.cropPluginId]?.cropFamily ?? null;
}

function computeAnchorWindow(
  anchor: Crop,
  members: ReadonlyArray<{ family: string; offsetDays: number; draft?: Crop }>,
  input: GroupPlanningInput
): { earliestAnchorMs: number; latestAnchorMs: number; recommendedAnchorMs: number } | null {
  const anchorPlugin = input.pluginIndex[anchor.cropPluginId];
  if (!anchorPlugin) return null;

  // Earliest = max of (anchor's soil-temp earliest, last-spring-frost + 0d).
  const anchorSoil = input.soilTempEarliestByCrop[anchor.cropPluginId] ?? input.lastSpringFrostMs;
  let earliest = Math.max(anchorSoil, input.lastSpringFrostMs);

  // Each member's plant date must also be ≥ that member's soil-temp earliest.
  for (const m of members) {
    if (!m.draft) continue;
    const memberSoil =
      input.soilTempEarliestByCrop[m.draft.cropPluginId] ?? input.lastSpringFrostMs;
    const offsetMs = m.offsetDays * DAY_MS;
    earliest = Math.max(earliest, memberSoil - offsetMs);
  }

  // Latest = first-fall-frost minus the longest member DTM (max).
  let longestDtm = anchorPlugin.daysToMaturity?.max ?? 90;
  let lastOffset = 0;
  for (const m of members) {
    if (!m.draft) continue;
    const memPlugin = input.pluginIndex[m.draft.cropPluginId];
    const memDtm = memPlugin?.daysToMaturity?.max ?? 90;
    const memEnd = m.offsetDays + memDtm;
    if (memEnd > longestDtm) longestDtm = memEnd;
    if (m.offsetDays > lastOffset) lastOffset = m.offsetDays;
  }
  const latest = input.firstFallFrostMs - longestDtm * DAY_MS;
  if (latest < earliest) return null;

  // Recommended = earliest + 7 days (give the operator slack against late
  // cold snaps; the AI / operator may move it forward or back).
  const recommended = Math.min(latest, earliest + 7 * DAY_MS);
  return {
    earliestAnchorMs: earliest,
    latestAnchorMs: latest,
    recommendedAnchorMs: recommended
  };
}

// ─── Engine fallback ─────────────────────────────────────────────────────

const SUCCESSION_INTERVAL_DAYS = 7;

function engineFallback(
  input: GroupPlanningInput,
  matrix: MatrixCandidate[],
  reason: 'engine-only' | 'no-api-key'
): GroupPlanningResult {
  const usedCropIds = new Set<string>();
  const proposed: ProposedPlan[] = [];

  // Pass 1 — group plans first. Each group locks all its member cropIds.
  for (const c of matrix.filter((m) => m.kind === 'group')) {
    if (c.memberCropIds.some((id) => usedCropIds.has(id))) continue;
    const plan = candidateToProposal(c, c.recommendedAnchorMs, input, groupRationale(c));
    if (!plan) continue;
    for (const id of c.memberCropIds) usedCropIds.add(id);
    proposed.push(plan);
  }

  // Pass 2 — singletons, succession-or-simultaneous per (block × family).
  scheduleSingletons(matrix, input, usedCropIds, proposed);

  const unscheduled = computeUnscheduled(input.drafts, proposed);
  return {
    proposed,
    unscheduled,
    meta: {
      model: 'engine-only',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      usdEstimate: 0,
      fallback: reason
    }
  };
}

/** For each (block × family) bucket of remaining singleton candidates,
 *  decide between a staggered succession (every N days) or a simultaneous
 *  mixed-cultivar planting at the earliest viable date — whichever fits the
 *  intersection of every member's window. Mutates `usedCropIds` and
 *  `proposed`. */
function scheduleSingletons(
  matrix: ReadonlyArray<MatrixCandidate>,
  input: GroupPlanningInput,
  usedCropIds: Set<string>,
  proposed: ProposedPlan[]
): void {
  const remaining = matrix
    .filter((m) => m.kind === 'singleton')
    .filter((c) => !c.memberCropIds.some((id) => usedCropIds.has(id)));

  // Bucket by (blockId × family).
  const buckets = new Map<string, MatrixCandidate[]>();
  for (const c of remaining) {
    const cropId = c.memberCropIds[0];
    const draft = input.drafts.find((d) => d.id === cropId);
    if (!draft) continue;
    const plugin = input.pluginIndex[draft.cropPluginId];
    if (!plugin) continue;
    const key = `${c.blockId}:${plugin.cropFamily}`;
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }

  for (const candidates of buckets.values()) {
    if (candidates.length === 0) continue;
    // Stable order by varietyDisplayName so the succession dates are
    // deterministic across regenerations.
    candidates.sort((a, b) => {
      const ad = input.drafts.find((d) => d.id === a.memberCropIds[0]);
      const bd = input.drafts.find((d) => d.id === b.memberCropIds[0]);
      return (ad?.varietyDisplayName ?? '').localeCompare(bd?.varietyDisplayName ?? '');
    });
    // Intersect windows so every member's date is viable.
    const earliest = Math.max(...candidates.map((c) => c.earliestAnchorMs));
    const latest = Math.min(...candidates.map((c) => c.latestAnchorMs));
    if (latest < earliest) continue;
    const span = latest - earliest;
    const successionFits =
      candidates.length > 1 && span >= (candidates.length - 1) * SUCCESSION_INTERVAL_DAYS * DAY_MS;

    candidates.forEach((c, idx) => {
      const cropId = c.memberCropIds[0];
      if (usedCropIds.has(cropId)) return;
      const date = successionFits ? earliest + idx * SUCCESSION_INTERVAL_DAYS * DAY_MS : earliest;
      const plan = candidateToProposal(
        c,
        date,
        input,
        singletonRationale(successionFits, idx, candidates.length)
      );
      if (!plan) return;
      usedCropIds.add(cropId);
      proposed.push(plan);
    });
  }
}

/** Backfill drafts that the AI's plan missed — schedule them as singletons
 *  using the same succession-or-simultaneous rules as the engine fallback,
 *  but only for drafts not already covered by an AI plan. */
function backfillMissedDrafts(
  aiProposals: ProposedPlan[],
  input: GroupPlanningInput,
  matrix: ReadonlyArray<MatrixCandidate>,
  displacedCropIds: ReadonlySet<string> = new Set()
): ProposedPlan[] {
  const usedCropIds = new Set<string>();
  for (const p of aiProposals) {
    usedCropIds.add(p.anchor.cropId);
    if (p.kind === 'group') for (const c of p.companions) usedCropIds.add(c.cropId);
  }
  // Treat displaced drafts as "already accounted for" so the singleton
  // scheduler doesn't try to backfill them — they belong in the
  // unscheduled list with the AI's reason instead.
  for (const id of displacedCropIds) usedCropIds.add(id);
  const out = [...aiProposals];
  scheduleSingletons(matrix, input, usedCropIds, out);
  return out;
}

function groupRationale(c: MatrixCandidate): string {
  if (c.kind === 'group' && c.systemName === 'Three Sisters') {
    return 'Three Sisters detected on this block — corn anchors first; beans climb the cornstalks; squash/pumpkin covers ground. Date placed at the earliest soil-temp + frost-safe window.';
  }
  return 'Auto-scheduled by the engine fallback.';
}

function singletonRationale(succession: boolean, idx: number, total: number): string {
  if (total === 1) {
    return 'Singleton planting at the earliest soil-temp + frost-safe window for this crop.';
  }
  if (succession) {
    return `Succession planting ${idx + 1} of ${total} on this block — staggered ${SUCCESSION_INTERVAL_DAYS} days apart so harvest is spread across the window.`;
  }
  return `Mixed-cultivar planting on this block — ${total} varieties planted simultaneously at the earliest viable date (succession window too tight for staggering).`;
}

function candidateToProposal(
  c: MatrixCandidate,
  anchorMs: number,
  input: GroupPlanningInput,
  rationale: string
): ProposedPlan | null {
  const block = input.blocks.find((b) => b.id === c.blockId);
  if (!block) return null;
  const anchorDraft = input.drafts.find((d) => d.id === c.memberCropIds[0]);
  if (!anchorDraft) return null;
  const anchorPlugin = input.pluginIndex[anchorDraft.cropPluginId];
  if (!anchorPlugin) return null;

  const anchor: PlanMember = {
    cropId: anchorDraft.id,
    cropPluginId: anchorDraft.cropPluginId,
    varietyDisplayName: anchorDraft.varietyDisplayName,
    cropFamily: anchorPlugin.cropFamily,
    offsetDays: 0,
    plantingDateMs: anchorMs
  };

  if (c.kind === 'singleton') {
    return {
      kind: 'singleton',
      systemKind: 'singleton',
      blockId: c.blockId,
      anchor,
      rationale,
      advisories: []
    };
  }

  // Group — resolve members.
  const system = SYSTEMS.find((s) => s.name === c.systemName);
  if (!system) return null;
  const companions: PlanMember[] = [];
  for (let i = 1; i < c.memberCropIds.length; i++) {
    const draft = input.drafts.find((d) => d.id === c.memberCropIds[i]);
    if (!draft) return null;
    const plugin = input.pluginIndex[draft.cropPluginId];
    if (!plugin) return null;
    const sysMember = system.members.find((m) => m.family === plugin.cropFamily);
    if (!sysMember) return null;
    companions.push({
      cropId: draft.id,
      cropPluginId: draft.cropPluginId,
      varietyDisplayName: draft.varietyDisplayName,
      cropFamily: plugin.cropFamily,
      offsetDays: sysMember.plantingOffsetDays,
      plantingDateMs: anchorMs + sysMember.plantingOffsetDays * DAY_MS
    });
  }
  return {
    kind: 'group',
    systemKind: 'three-sisters',
    blockId: c.blockId,
    anchor,
    companions,
    rationale,
    advisories: []
  };
}

function computeUnscheduled(
  drafts: ReadonlyArray<Crop>,
  proposed: ReadonlyArray<ProposedPlan>,
  displacedDrafts: ReadonlyArray<AiDisplacedDraft> = []
): Array<{ cropId: string; reason: string; kind: 'window-conflict' | 'density-displaced' }> {
  const used = new Set<string>();
  for (const p of proposed) {
    used.add(p.anchor.cropId);
    if (p.kind === 'group') for (const c of p.companions) used.add(c.cropId);
  }
  const displacedById = new Map(displacedDrafts.map((d) => [d.cropId, d.reason]));
  return drafts
    .filter((d) => !used.has(d.id))
    .map((d) => {
      const aiReason = displacedById.get(d.id);
      if (aiReason) {
        return { cropId: d.id, reason: aiReason, kind: 'density-displaced' as const };
      }
      return {
        cropId: d.id,
        reason: 'No viable plan found; adjust soil-temp window or attach to a different block.',
        kind: 'window-conflict' as const
      };
    });
}

// ─── Prompt + AI parsing ─────────────────────────────────────────────────

function buildGroupPrompt(matrix: MatrixCandidate[], input: GroupPlanningInput): string {
  const draftRows = input.drafts.map((d) => {
    const plugin = input.pluginIndex[d.cropPluginId];
    const dens = input.densityByDraft?.[d.id];
    const densStr = dens
      ? `|footprint=${dens.footprintSqFt.toFixed(0)}sqft|vine=${dens.vineSpreadFt ?? '-'}ft|fit=${dens.plantsFit ?? '-'}|have=${dens.plantsAvailable ?? '-'}|util=${dens.utilizationPct?.toFixed(2) ?? '-'}`
      : '';
    return `${d.id}|${plugin?.cropFamily ?? '?'}|${d.cropPluginId}|${d.varietyDisplayName}|block=${d.blockId}${densStr}`;
  });
  const matrixRows = matrix.map((c) => {
    const earliest = isoDay(c.earliestAnchorMs);
    const latest = isoDay(c.latestAnchorMs);
    const recommended = isoDay(c.recommendedAnchorMs);
    return `${c.id}|${c.kind}|${c.systemKind}|block=${c.blockId}|members=[${c.memberCropIds.join(',')}]|window=${earliest}..${latest}|recommended=${recommended}`;
  });

  // Per-block combined-family density summary so the AI can see overflow at
  // a glance without recomputing from per-draft rows.
  const blockFamilySummary: string[] = [];
  if (input.densityByDraft) {
    type Acc = { totalFit: number; totalHave: number; varieties: number; vineMax: number };
    const buckets = new Map<string, Acc>();
    for (const d of input.drafts) {
      const dens = input.densityByDraft[d.id];
      const family = input.pluginIndex[d.cropPluginId]?.cropFamily ?? '?';
      if (!dens || dens.plantsFit == null || dens.plantsAvailable == null) continue;
      const key = `${d.blockId}:${family}`;
      const acc = buckets.get(key) ?? { totalFit: 0, totalHave: 0, varieties: 0, vineMax: 0 };
      acc.totalFit = Math.max(acc.totalFit, dens.plantsFit);
      acc.totalHave += dens.plantsAvailable;
      acc.varieties += 1;
      acc.vineMax = Math.max(acc.vineMax, dens.vineSpreadFt ?? 0);
      buckets.set(key, acc);
    }
    for (const [k, v] of buckets) {
      if (v.varieties < 2) continue;
      const ratio = v.totalFit > 0 ? (v.totalHave / v.totalFit).toFixed(2) : '-';
      blockFamilySummary.push(
        `${k}|varieties=${v.varieties}|combined_have=${v.totalHave}|max_fit=${v.totalFit}|combined_util=${ratio}|max_vine=${v.vineMax}ft`
      );
    }
  }

  return [
    'Task: propose planting plans for this season.',
    '',
    'Drafts (cropId|family|pluginId|variety|block[|footprint|vine|fit|have|util]):',
    ...draftRows,
    '',
    blockFamilySummary.length > 0
      ? 'Combined-family density per block (block:family|varieties|combined_have|max_fit|combined_util|max_vine):'
      : '',
    ...blockFamilySummary,
    blockFamilySummary.length > 0 ? '' : '',
    'Candidate plans you may pick from (id|kind|systemKind|block|members|window|recommended):',
    ...matrixRows,
    '',
    'Rules:',
    '- EVERY draft listed above SHOULD appear in some plan unless density forces displacement (see DENSITY rules). Operators attach drafts to blocks intending to plant them; do not silently drop them.',
    '- Each cropId may appear in at most ONE chosen plan.',
    '- Multiple plans on the same block are allowed and required when more than one draft is attached.',
    '- For multiple same-family same-block drafts (e.g., 7 cucurbit varieties on one block), schedule them as either:',
    '    (a) a SUCCESSION — stagger anchor dates by 7 days within the viable window, OR',
    '    (b) a SIMULTANEOUS mixed-cultivar planting — same date for all — when the window is too tight to stagger.',
    "  Pick whichever fits the intersection of every variety's window. Cucurbits (≥120 DTM) usually go simultaneous; quick crops (lettuce/radish, ≤45 DTM) usually go succession.",
    '- Prefer group plans (e.g., Three Sisters) over singletons when the group is available on a block.',
    "- Anchor plant date MUST be within the candidate's window (earliest..latest).",
    '- Companion offsets are FIXED by the system definition — do not change them.',
    '- Plant dates should default to the recommended date unless soil/frost or stagger rationale says otherwise.',
    '',
    'DENSITY rules (Phase 15e — read carefully):',
    '- A draft with util > 1.25 (its own seed alone overflows the block) should be DISPLACED via the displacedDrafts[] field with a clear reason.',
    '- A draft with vine ≥ 10 ft on a block where other same-family drafts exist effectively claims the whole block — DISPLACE the smaller varieties. Add them to displacedDrafts[] with reason mentioning the vine cultivar.',
    '- For each (block, family) row above where combined_util > 1.25, displace enough varieties to bring combined_util to ≤ 1.0 (prefer keeping varieties whose individual util ≤ 1.0 over surplus ones; prefer keeping vining cultivars solo).',
    '- displacedDrafts entries should suggest the next step in the reason: "move to <other block name>", "reduce seed quantity", or "delete this draft".',
    '',
    'Per-plan output:',
    '- Provide a short (≤140 char) rationale per plan referencing soil-temp / frost / companion benefit / succession position.',
    '- Optional advisories[] for things the operator should know but the engine cannot enforce.',
    '',
    'Return JSON:',
    '{',
    '  "plans": [',
    '    {"candidateId":"<matrix id>", "anchorPlantingDate":"YYYY-MM-DD", "rationale":"...", "advisories":["..."]}',
    '  ],',
    '  "displacedDrafts": [',
    '    {"cropId":"<draft id>", "reason":"plain-english why this draft was dropped + suggested next step"}',
    '  ]',
    '}',
    'No other top-level keys, no prose, no code fences. displacedDrafts may be an empty array.'
  ]
    .filter((line) => line !== '' || true)
    .join('\n');
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

interface AiPlanRow {
  candidateId: string;
  anchorPlantingDateMs: number;
  rationale: string;
  advisories: string[];
}

interface AiDisplacedDraft {
  cropId: string;
  reason: string;
}

interface ValidatedAiPlans {
  valid: true;
  plans: AiPlanRow[];
  /** Phase 15e — drafts the AI deliberately did not schedule, with a
   *  short reason. The engine respects these (won't backfill them) and
   *  surfaces them in GroupPlanningResult.unscheduled with kind='density-displaced'. */
  displacedDrafts: AiDisplacedDraft[];
}
interface InvalidAiPlans {
  valid: false;
  violations: string[];
  plans?: undefined;
  displacedDrafts?: undefined;
}

export function validateAiPlans(
  raw: unknown,
  input: GroupPlanningInput,
  matrix: MatrixCandidate[]
): ValidatedAiPlans | InvalidAiPlans {
  const violations: string[] = [];
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { plans?: unknown }).plans)) {
    return { valid: false, violations: ['response missing plans[]'] };
  }
  const candidates = new Map(matrix.map((c) => [c.id, c]));
  const usedCropIds = new Set<string>();
  const out: AiPlanRow[] = [];

  for (const item of (raw as { plans: unknown[] }).plans) {
    if (!item || typeof item !== 'object') {
      violations.push('plan item is not an object');
      continue;
    }
    const obj = item as {
      candidateId?: unknown;
      anchorPlantingDate?: unknown;
      rationale?: unknown;
      advisories?: unknown;
    };
    const candidateId = typeof obj.candidateId === 'string' ? obj.candidateId : null;
    if (!candidateId) {
      violations.push('plan missing candidateId');
      continue;
    }
    const candidate = candidates.get(candidateId);
    if (!candidate) {
      violations.push(`unknown candidateId: ${candidateId}`);
      continue;
    }
    const dateStr = typeof obj.anchorPlantingDate === 'string' ? obj.anchorPlantingDate : null;
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      violations.push(`plan ${candidateId}: invalid anchorPlantingDate`);
      continue;
    }
    const anchorMs = Date.UTC(
      Number(dateStr.slice(0, 4)),
      Number(dateStr.slice(5, 7)) - 1,
      Number(dateStr.slice(8, 10))
    );
    if (anchorMs < candidate.earliestAnchorMs || anchorMs > candidate.latestAnchorMs) {
      violations.push(
        `plan ${candidateId}: anchorPlantingDate ${dateStr} outside window ${isoDay(candidate.earliestAnchorMs)}..${isoDay(candidate.latestAnchorMs)}`
      );
      continue;
    }
    if (candidate.memberCropIds.some((id) => usedCropIds.has(id))) {
      violations.push(`plan ${candidateId}: a member cropId is reused across plans`);
      continue;
    }
    for (const id of candidate.memberCropIds) usedCropIds.add(id);
    const rationale = typeof obj.rationale === 'string' ? obj.rationale.slice(0, 280) : '';
    const advisories = Array.isArray(obj.advisories)
      ? obj.advisories.filter((a): a is string => typeof a === 'string').slice(0, 6)
      : [];
    out.push({ candidateId, anchorPlantingDateMs: anchorMs, rationale, advisories });
  }

  // Phase 15e — accept top-level `displacedDrafts` so the AI can
  // deliberately drop drafts that overflow the block. Each entry must
  // reference a real draft cropId AND must NOT also appear in any plan.
  const displacedDrafts: AiDisplacedDraft[] = [];
  const draftIds = new Set(input.drafts.map((d) => d.id));
  const displacedRaw = (raw as { displacedDrafts?: unknown }).displacedDrafts;
  if (Array.isArray(displacedRaw)) {
    for (const d of displacedRaw) {
      if (!d || typeof d !== 'object') continue;
      const obj = d as { cropId?: unknown; reason?: unknown };
      const cropId = typeof obj.cropId === 'string' ? obj.cropId : null;
      if (!cropId || !draftIds.has(cropId)) {
        violations.push(`displacedDrafts entry references unknown cropId ${cropId ?? '(missing)'}`);
        continue;
      }
      if (usedCropIds.has(cropId)) {
        violations.push(`cropId ${cropId} appears in both a plan and displacedDrafts`);
        continue;
      }
      const reason = typeof obj.reason === 'string' ? obj.reason.slice(0, 280) : 'AI displaced';
      displacedDrafts.push({ cropId, reason });
    }
  }

  if (violations.length > 0) return { valid: false, violations };
  return { valid: true, plans: out, displacedDrafts };
}

function materializeProposals(
  rows: ReadonlyArray<AiPlanRow>,
  input: GroupPlanningInput,
  matrix: ReadonlyArray<MatrixCandidate>
): ProposedPlan[] {
  const byId = new Map(matrix.map((c) => [c.id, c]));
  const out: ProposedPlan[] = [];
  for (const r of rows) {
    const c = byId.get(r.candidateId);
    if (!c) continue;
    const proposal = candidateToProposal(c, r.anchorPlantingDateMs, input, r.rationale);
    if (proposal) {
      proposal.advisories = r.advisories;
      out.push(proposal);
    }
  }
  return out;
}

// ─── Claude wrapper ──────────────────────────────────────────────────────

interface ClaudeCallResult {
  parsed: unknown;
  meta: AiResultMeta;
}

/** Stringify a previously-parsed AI response back into JSON text so we can
 *  echo it on a retry. Falls back to a minimal placeholder if parsing
 *  produced something unexpected. */
function stringifyForRetry(parsed: unknown): string {
  try {
    return JSON.stringify(parsed ?? { plans: [] }, null, 2);
  } catch {
    return '{ "plans": [] }';
  }
}

/**
 * Phase 15e — multi-turn retry. Sends the original user prompt, then the
 * previous (rejected) assistant response, then a targeted correction prompt
 * listing the violations. Cached system prompt is preserved so the system
 * context isn't re-billed. Cost: extra ~previous-response tokens as input;
 * worth it because Claude can amend rather than restart, especially when
 * the violations are semantic (capacity exceeded, displaced conflicts).
 */
interface TelemetryConfig {
  planningSessionId?: string;
  contextCacheHit: boolean;
  derivedSignalHit: boolean;
}

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
    'Your previous response had these violations:\n' +
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
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    parsed = null;
  }
  const meta = computeMeta(msg.usage, model);
  recordGroupsTelemetry(meta, durationMs, telemetry);
  appendGroupsTurn(telemetry.planningSessionId, correctionText, text, meta);
  return { parsed, meta };
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
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    parsed = null;
  }
  const meta = computeMeta(msg.usage, model);
  recordGroupsTelemetry(meta, durationMs, telemetry);
  appendGroupsTurn(telemetry.planningSessionId, userPrompt, text, meta);
  return { parsed, meta };
}

function computeMeta(rawUsage: unknown, model: string): AiResultMeta {
  const usage =
    (rawUsage as {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
      output_tokens?: number;
    }) ?? {};
  const choice = selectModel('groups');
  const meta: AiResultMeta = {
    model,
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    cachedInputTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    usdEstimate: 0
  };
  meta.usdEstimate = estimateUsd(meta, choice);
  return meta;
}

function recordGroupsTelemetry(
  meta: AiResultMeta,
  durationMs: number,
  telemetry: TelemetryConfig
): void {
  recordAiCall({
    endpoint: 'groups',
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

function appendGroupsTurn(
  planningSessionId: string | undefined,
  userPrompt: string,
  assistantResponse: string,
  meta: AiResultMeta
): void {
  if (!planningSessionId) return;
  appendTurn(planningSessionId, {
    endpoint: 'groups',
    userPrompt,
    assistantResponse,
    inputTokens: meta.inputTokens,
    cachedInputTokens: meta.cachedInputTokens,
    outputTokens: meta.outputTokens,
    occurredAt: Date.now()
  });
}

/** Stable hash of the inputs the group matrix depends on (draft ids, block
 *  ids, year). Used as the derived-signal subKey so a stale matrix from a
 *  different draft set doesn't get reused. */
function hashInputsForMatrix(input: GroupPlanningInput): string {
  const draftKey = input.drafts
    .map((d) => `${d.id}:${d.cropPluginId}:${d.blockId}`)
    .sort()
    .join(',');
  const blockKey = input.blocks
    .map((b) => b.id)
    .sort()
    .join(',');
  return `${input.year}|${draftKey}|${blockKey}`;
}

function addMeta(target: AiResultMeta, src: AiResultMeta): void {
  target.inputTokens += src.inputTokens;
  target.cachedInputTokens += src.cachedInputTokens;
  target.outputTokens += src.outputTokens;
  target.usdEstimate += src.usdEstimate;
  target.model = src.model;
}

function groupBy<T, K>(arr: ReadonlyArray<T>, key: (t: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of arr) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}
