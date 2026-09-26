/**
 * "Fill this bed" with Claude (Phase 30E). The endpoint runs this through
 * `tryAiWithGuard` (aiTry + aiGuard); every proposal Claude returns is
 * checked here before the owner sees it, and anything that fails is dropped.
 * When nothing survives, the caller answers with the deterministic plan.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { footprintSchema, SPACING_PATTERNS, type Footprint } from '$lib/farm/footprint';
import { footprintsOverlap } from '$lib/garden/geometry';
import { plantingOccupancy } from '$lib/garden/occupancy';
import { plantCount, resolveSpacing } from '$lib/garden/plantCount';
import { dayOf, type RecipeContext } from '$lib/garden/recipes';
import type { OccupancyInterval, ProposedPlanting } from '$lib/garden/types';
import type { FrostDatesIso, PlantingWindow } from '$lib/plan/plantingWindow';
import { extractJsonObject } from './aiJsonExtract';
import { estimateUsd, selectModel, type AiResultMeta } from './aiPlanning';
import { getApiKey } from './scanResult';

export const MAX_AI_PROPOSALS = 12;
const MAX_NOTE_CHARS = 140;
const SNAP_IN = 6;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface GardenFillCropFact {
  cropPluginId: string;
  name: string;
  family: string;
  daysToMaturity: { min: number; max: number } | null;
  inRowSpacingIn: number;
  rowSpacingIn: number;
  plants: number | null;
}

export interface GardenFillPromptInput {
  bed: { name: string; widthFt: number; lengthFt: number };
  seasonYear: number;
  dateIso: string;
  frost: FrostDatesIso;
  occupied: Array<{ name: string; fromIso: string; untilIso: string; footprint: Footprint | null }>;
  history: Array<{ year: number; name: string; family: string }>;
  plannedCrops: GardenFillCropFact[];
  recipes: Array<{ pluginId: string; name: string; description: string; steps: string[] }>;
}

export interface GardenFillAiResult {
  /** Null when the reply was not the JSON shape asked for. */
  proposals: unknown[] | null;
  meta: AiResultMeta;
}

function fmtFootprint(fp: Footprint | null): string {
  return fp ? `x ${fp.x_in} in, y ${fp.y_in} in, ${fp.w_in}×${fp.l_in} in` : 'the whole bed';
}

export function buildGardenFillPrompt(input: GardenFillPromptInput): string {
  const widthIn = input.bed.widthFt * 12;
  const lengthIn = input.bed.lengthFt * 12;
  const lines = [
    `Suggest what to plant in one garden bed for the ${input.seasonYear} season, starting on or after ${input.dateIso}.`,
    `Bed "${input.bed.name}": ${widthIn} in wide (x) by ${lengthIn} in long (y), origin at the top-left corner.`,
    `Average last spring frost: ${input.frost.lastSpring}. First fall frost: ${input.frost.firstFall}.`,
    '',
    'Already in this bed (do not overlap these in both space and time):',
    ...(input.occupied.length
      ? input.occupied.map(
          (o) => `- ${o.name}: ${o.fromIso} to ${o.untilIso}, ${fmtFootprint(o.footprint)}`
        )
      : ['- nothing']),
    '',
    'Grown here in earlier seasons (rotate families away from these):',
    ...(input.history.length
      ? input.history.map((h) => `- ${h.year}: ${h.name} (${h.family})`)
      : ['- no history']),
    '',
    "The owner's planned crops that still need a spot:",
    ...(input.plannedCrops.length
      ? input.plannedCrops.map(
          (c) =>
            `- ${c.cropPluginId}: ${c.name}, ${c.family}, ${c.daysToMaturity ? `${c.daysToMaturity.min}-${c.daysToMaturity.max}` : 'unknown'} days to maturity, ${c.inRowSpacingIn} in in-row, ${c.rowSpacingIn} in between rows${c.plants ? `, wants ${c.plants} plants` : ''}`
        )
      : ['- none']),
    '',
    'Bed recipes that fit this season (sequences that work here):',
    ...(input.recipes.length
      ? input.recipes.map(
          (r) => `- ${r.pluginId}: ${r.name}. ${r.description} Steps: ${r.steps.join('; ')}`
        )
      : ['- none']),
    '',
    'Rules:',
    '- Use only cropPluginId values listed above.',
    `- Footprints are inches inside the bed: 0 <= x_in, x_in + w_in <= ${widthIn}, 0 <= y_in, y_in + l_in <= ${lengthIn}. Use multiples of 6.`,
    `- plantingDate is YYYY-MM-DD in ${input.seasonYear}, on or after ${input.dateIso}, inside the crop's usual planting window for these frost dates.`,
    '- Each crop must be ready to harvest before the first fall frost.',
    `- At most ${MAX_AI_PROPOSALS} plantings. pattern is "square" (rows), "offset" (intensive) or "sfg" (square foot).`,
    `- note: one plain sentence under ${MAX_NOTE_CHARS} characters, or omit it.`,
    '',
    'Return JSON only: { "proposals": [ { "cropPluginId": "...", "plantingDate": "YYYY-MM-DD", "footprint": { "x_in": 0, "y_in": 0, "w_in": 48, "l_in": 48 }, "pattern": "square", "note": "..." } ] }'
  ];
  return lines.join('\n');
}

/** The `proposals` array from Claude's reply, or null when the reply is not
 *  that JSON shape. Items are checked later, one by one. */
export function parseGardenFillResponse(text: string): unknown[] | null {
  const raw = extractJsonObject(text);
  if (!raw || typeof raw !== 'object') return null;
  const proposals = (raw as { proposals?: unknown }).proposals;
  return Array.isArray(proposals) ? proposals : null;
}

export async function suggestGardenFill(
  input: GardenFillPromptInput,
  signal?: AbortSignal
): Promise<GardenFillAiResult> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('no api key');
  const choice = selectModel('gardenFill');
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create(
    {
      model: choice.model,
      max_tokens: 1500,
      messages: [{ role: 'user', content: buildGardenFillPrompt(input) }]
    },
    { signal }
  );
  const text = msg.content[0]?.type === 'text' ? msg.content[0].text : '';
  const usage = msg.usage as {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
  const meta: AiResultMeta = {
    model: choice.model,
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    cachedInputTokens: usage.cache_read_input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    usdEstimate: 0
  };
  meta.usdEstimate = estimateUsd(meta, choice, usage);
  return { proposals: parseGardenFillResponse(text), meta };
}

const aiProposalSchema = z.object({
  cropPluginId: z.string().min(1).max(128),
  plantingDate: z.string().regex(ISO_DAY),
  footprint: footprintSchema,
  pattern: z.enum(SPACING_PATTERNS).optional(),
  note: z.string().optional()
});

function sanitizeNote(note: string | undefined): string | null {
  if (!note) return null;
  const trimmed = note.replace(/\p{Cc}/gu, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_NOTE_CHARS ? `${trimmed.slice(0, MAX_NOTE_CHARS - 1)}…` : trimmed;
}

function dayFromIso(iso: string): number | null {
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

function snap(v: number): number {
  return Math.round(v / SNAP_IN) * SNAP_IN;
}

export interface FillValidationContext extends RecipeContext {
  /** Scrubber date; proposals must start on or after this day. */
  dateMs: number;
  /** The crop's planting window for these frost dates, or null when the
   *  crop is unknown. */
  plantingWindow: (cropPluginId: string) => PlantingWindow | null;
}

function overlaps(
  a: { startMs: number; endMs: number; footprint: Footprint | null },
  b: { startMs: number; endMs: number; footprint: Footprint | null }
): boolean {
  if (!(a.startMs < b.endMs && b.startMs < a.endMs)) return false;
  if (!a.footprint || !b.footprint) return true;
  return footprintsOverlap(a.footprint, b.footprint);
}

/** Keeps each proposal that names a registered crop, fits inside the bed
 *  once snapped to 6 in, starts inside the season and the crop's planting
 *  window, matures before the first fall frost, and shares no space and
 *  time with an existing planting or an earlier kept proposal. */
export function validateFillProposals(
  raw: readonly unknown[],
  ctx: FillValidationContext
): ProposedPlanting[] {
  const widthIn = ctx.bed.widthFt * 12;
  const lengthIn = ctx.bed.lengthFt * 12;
  const dayMs = dayOf(ctx.dateMs);
  const kept: ProposedPlanting[] = [];
  const keptIntervals: OccupancyInterval[] = [];
  for (const item of raw.slice(0, MAX_AI_PROPOSALS * 2)) {
    if (kept.length >= MAX_AI_PROPOSALS) break;
    const parsed = aiProposalSchema.safeParse(item);
    if (!parsed.success) continue;
    const p = parsed.data;
    const crop = ctx.crops[p.cropPluginId];
    const window = ctx.plantingWindow(p.cropPluginId);
    if (!crop || !window) continue;
    if (p.plantingDate < window.earliest || p.plantingDate > window.latest) continue;
    if (!p.plantingDate.startsWith(String(ctx.seasonYear))) continue;
    const plantingDateMs = dayFromIso(p.plantingDate);
    if (plantingDateMs === null || plantingDateMs < dayMs) continue;
    const footprint: Footprint = {
      x_in: snap(p.footprint.x_in),
      y_in: snap(p.footprint.y_in),
      w_in: Math.max(SNAP_IN, snap(p.footprint.w_in)),
      l_in: Math.max(SNAP_IN, snap(p.footprint.l_in))
    };
    if (footprint.x_in + footprint.w_in > widthIn || footprint.y_in + footprint.l_in > lengthIn) {
      continue;
    }
    const key = `ai${kept.length}`;
    const interval = plantingOccupancy(
      {
        cropId: key,
        blockId: ctx.bed.blockId,
        cropPluginId: crop.pluginId,
        status: 'planned',
        plantingDateMs,
        harvestedAtMs: null,
        footprint
      },
      crop,
      { firstFallFrostMs: ctx.firstFallFrostMs }
    );
    if (!interval || interval.harvestStartMs > ctx.firstFallFrostMs) continue;
    const clash = [
      ...ctx.intervals.filter((i) => i.blockId === ctx.bed.blockId),
      ...keptIntervals
    ].some((other) => overlaps(other, interval));
    if (clash) continue;
    const spacing = resolveSpacing(crop, p.pattern ?? 'square');
    keptIntervals.push(interval);
    kept.push({
      key,
      blockId: ctx.bed.blockId,
      cropPluginId: crop.pluginId,
      varietyDisplayName: crop.displayName,
      plantingDateMs,
      footprint,
      spacing,
      plantCount: plantCount(footprint, spacing).count,
      provenance: 'ai',
      note: sanitizeNote(p.note),
      followsKey: null
    });
  }
  return kept;
}
