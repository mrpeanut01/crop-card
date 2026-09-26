/**
 * "Fill this bed" (Phase 30E): Claude proposes through `tryAiWithGuard`, the
 * server checks every proposal, and the deterministic recipe or packing
 * plan answers whenever Claude is off, over its limit, slow, or returns
 * nothing usable. Proposals only; accepted rows are saved separately.
 */

import { listBlocks } from '$lib/db/blocks';
import { listCrops, type Crop } from '$lib/db/crops';
import type { FillRequest, FillResponse } from '$lib/garden/api';
import { occupancyIntervals } from '$lib/garden/occupancy';
import { resolveSpacing } from '$lib/garden/plantCount';
import {
  dayOf,
  deterministicFillPlan,
  frostFreeDays,
  recipeFits,
  type DeterministicFillPlan,
  type RecipeContext,
  type UnplacedCrop
} from '$lib/garden/recipes';
import type { GardenCrop } from '$lib/garden/types';
import { deterministicPlantingWindow, type PlantingWindow } from '$lib/plan/plantingWindow';
import type { BedRecipePlugin, CropPlugin } from '$lib/plugins/schemas';
import { frostDatesForYear, frostDatesIsoForYear } from '$lib/schedule/settings';
import { recordFallback, tryAiWithGuard } from '../aiDegrade';
import type { FallbackReason } from '../aiTry';
import { recordCall } from '../aiGuard';
import {
  suggestGardenFill,
  validateFillProposals,
  type GardenFillCropFact,
  type GardenFillPromptInput
} from '../aiGardenFill';
import { placedPlantingFromCrop, type DesignableBed } from './placement';

export const GARDEN_FILL_TIMEOUT_MS = 6000;
const DAY_MS = 86_400_000;

function isoDay(ms: number): string {
  return new Date(dayOf(ms)).toISOString().slice(0, 10);
}

function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

export interface FillInputs {
  ctx: RecipeContext;
  unplaced: UnplacedCrop[];
  recipes: BedRecipePlugin[];
  history: Crop[];
  crops: Readonly<Record<string, CropPlugin>>;
}

/** Everything the fill needs, read through the tenant-scoped repos. */
export function loadFillInputs(
  bed: DesignableBed,
  req: FillRequest,
  crops: Readonly<Record<string, CropPlugin>>,
  recipes: readonly BedRecipePlugin[]
): FillInputs {
  const { lastSpringFrostMs, firstFallFrostMs } = frostDatesForYear(req.seasonYear);
  const bedCrops = listCrops({ blockId: bed.block.id });
  const intervals = occupancyIntervals(
    bedCrops.map((c) => placedPlantingFromCrop(c, crops[c.cropPluginId])),
    crops,
    { firstFallFrostMs, lastSpringFrostMs }
  );
  const areaBedIds = new Set(
    listBlocks()
      .filter((b) => b.fieldId === bed.area.id)
      .map((b) => b.id)
  );
  const unplaced: UnplacedCrop[] = [];
  const seen = new Set<string>();
  for (const c of listCrops({ status: 'planned' })) {
    if (!areaBedIds.has(c.blockId) || c.footprint || !crops[c.cropPluginId]) continue;
    if (seen.has(c.cropPluginId)) continue;
    seen.add(c.cropPluginId);
    unplaced.push({
      cropPluginId: c.cropPluginId,
      varietyDisplayName: c.varietyDisplayName,
      plants: c.plantCount ?? null
    });
  }
  for (const id of req.cropPluginIds ?? []) {
    const plugin = crops[id];
    if (!plugin || seen.has(id)) continue;
    seen.add(id);
    unplaced.push({ cropPluginId: id, varietyDisplayName: plugin.displayName, plants: null });
  }
  const history = bedCrops.filter(
    (c) => c.plantingDate != null && new Date(c.plantingDate).getFullYear() < req.seasonYear
  );
  return {
    ctx: {
      bed: { blockId: bed.block.id, widthFt: bed.widthFt, lengthFt: bed.lengthFt },
      crops,
      lastSpringFrostMs,
      firstFallFrostMs,
      intervals,
      seasonYear: req.seasonYear
    },
    unplaced,
    recipes: [...recipes],
    history,
    crops
  };
}

function cropFact(
  crop: GardenCrop,
  plants: number | null,
  window: PlantingWindow | null = null
): GardenFillCropFact {
  const spacing = resolveSpacing(crop, 'square');
  return {
    window: window ? { earliest: window.earliest, latest: window.latest } : null,
    cropPluginId: crop.pluginId,
    name: crop.displayName,
    family: crop.cropFamily,
    daysToMaturity: crop.daysToMaturity ?? null,
    inRowSpacingIn: spacing.inRowIn,
    rowSpacingIn: spacing.rowIn,
    plants
  };
}

export function buildPromptInput(
  bed: DesignableBed,
  inputs: FillInputs,
  dateMs: number
): GardenFillPromptInput {
  const { ctx } = inputs;
  const ffd = frostFreeDays(ctx.lastSpringFrostMs, ctx.firstFallFrostMs);
  const fitting = inputs.recipes.filter((r) => recipeFits(r, ffd).fits);
  const names = new Map(listCropNames(inputs));
  const windowOf = windowLookup(inputs);
  const plannedIds = new Set(inputs.unplaced.map((u) => u.cropPluginId));
  const plannedCrops = inputs.unplaced
    .map((u) => {
      const crop = inputs.crops[u.cropPluginId];
      return crop ? cropFact(crop, u.plants, windowOf(u.cropPluginId)) : null;
    })
    .filter((f): f is GardenFillCropFact => f !== null);
  const recipeIds = new Set<string>();
  for (const r of fitting) {
    for (const s of r.steps) {
      const id = [s.cropPluginId, ...s.alternates].find((c) => inputs.crops[c]);
      if (id && !plannedIds.has(id)) recipeIds.add(id);
    }
  }
  const today = isoDay(dateMs);
  const recipeCrops = [...recipeIds]
    .map((id) => cropFact(inputs.crops[id], null, windowOf(id)))
    .filter((c) => !c.window || c.window.latest >= today);
  return {
    bed: { name: bed.block.name, widthFt: bed.widthFt, lengthFt: bed.lengthFt },
    seasonYear: ctx.seasonYear,
    dateIso: isoDay(dateMs),
    frost: frostDatesIsoForYear(ctx.seasonYear),
    occupied: ctx.intervals.map((i) => ({
      name: names.get(i.cropId) ?? 'a planting',
      fromIso: isoDay(i.startMs),
      untilIso: isoDay(i.endMs),
      footprint: i.footprint
    })),
    history: inputs.history.slice(0, 12).map((c) => ({
      year: new Date(c.plantingDate!).getFullYear(),
      name: c.varietyDisplayName,
      family: inputs.crops[c.cropPluginId]?.cropFamily ?? 'unknown'
    })),
    plannedCrops,
    recipeCrops,
    recipes: fitting.map((r) => ({
      pluginId: r.pluginId,
      name: r.displayName,
      description: r.description,
      steps: r.steps.map((s) => {
        const ids = [s.cropPluginId, ...s.alternates].filter((id) => inputs.crops[id]);
        return `${ids[0] ?? s.cropPluginId} ${stepWhen(s.start, ctx)}`;
      })
    }))
  };
}

function stepWhen(start: BedRecipePlugin['steps'][number]['start'], ctx: RecipeContext): string {
  if (start.anchor === 'after-step') return `after step ${(start.afterStep ?? 0) + 1}`;
  const base = start.anchor === 'last-spring-frost' ? ctx.lastSpringFrostMs : ctx.firstFallFrostMs;
  return `around ${isoDay(base + start.offsetDays * DAY_MS)}`;
}

function listCropNames(inputs: FillInputs): Array<[string, string]> {
  return listCrops({ blockId: inputs.ctx.bed.blockId }).map((c) => [c.id, c.varietyDisplayName]);
}

function windowLookup(inputs: FillInputs): (id: string) => PlantingWindow | null {
  const frost = frostDatesIsoForYear(inputs.ctx.seasonYear);
  return (id) => {
    const crop = inputs.crops[id];
    if (!crop) return null;
    return deterministicPlantingWindow(
      {
        cropFamily: crop.cropFamily,
        soilTempMinF: crop.plantingGuide?.soilTempMinF ?? null,
        dtmMaxDays: crop.daysToMaturity?.max ?? null
      },
      frost
    );
  };
}

type Why = FallbackReason | 'invalid' | 'quota';

const WHY_PREFIX: Record<Why, string> = {
  'no-key': 'Claude is off',
  'over-cap': "Claude has reached this month's spending cap",
  quota: "Claude has reached today's limit for this",
  'rate-limit': "Claude isn't answering right now",
  offline: "Claude can't be reached right now",
  timeout: 'Claude took too long',
  invalid: "Claude's ideas didn't fit this bed"
};

export function fallbackMessage(why: Why, plan: DeterministicFillPlan, dateMs: number): string {
  const prefix = WHY_PREFIX[why];
  if (plan.proposals.length === 0) {
    return `${prefix}, and no recipe or planned crop fits this bed on ${longDate(dateMs)}. Try a later date or free up some space.`;
  }
  const source = plan.recipe
    ? `a plain plan from the ${plan.recipe.displayName} recipe`
    : 'a plain plan that fits your planned crops by spacing';
  return `${prefix}, so this is ${source}. Everything here works the same.`;
}

export async function fillBed(args: {
  userId: string;
  bed: DesignableBed;
  req: FillRequest;
  inputs: FillInputs;
}): Promise<FillResponse> {
  const { userId, bed, req, inputs } = args;
  const plan = deterministicFillPlan(inputs.recipes, inputs.unplaced, inputs.ctx, req.dateMs);
  const tried = await tryAiWithGuard({
    endpoint: 'garden-fill',
    userId,
    timeoutMs: GARDEN_FILL_TIMEOUT_MS,
    prompt: (signal) => suggestGardenFill(buildPromptInput(bed, inputs, req.dateMs), signal)
  });

  if (tried.provenance === 'fallback') {
    recordFallback(userId, 'garden-fill', tried.fallbackReason);
    const why: Why =
      !tried.guard.ok && tried.guard.reason === 'quota-exceeded' ? 'quota' : tried.fallbackReason;
    return {
      proposals: plan.proposals,
      provenance: 'fallback',
      fallbackReason: tried.fallbackReason,
      message: fallbackMessage(why, plan, req.dateMs)
    };
  }

  const { proposals: raw, meta } = tried.value;
  const proposals = validateFillProposals(raw ?? [], {
    ...inputs.ctx,
    dateMs: req.dateMs,
    plantingWindow: windowLookup(inputs)
  });
  try {
    recordCall({
      userId,
      endpoint: 'garden-fill',
      model: meta.model,
      inputTokens: meta.inputTokens,
      cachedInputTokens: meta.cachedInputTokens,
      outputTokens: meta.outputTokens,
      usdEstimate: meta.usdEstimate,
      success: proposals.length > 0,
      errorClass: proposals.length > 0 ? undefined : raw ? 'no-valid-proposals' : 'invalid-json',
      provenance: proposals.length > 0 ? 'ai' : 'fallback'
    });
  } catch (err) {
    console.error('[ai] garden-fill recordCall failed', err);
  }
  if (proposals.length === 0) {
    return {
      proposals: plan.proposals,
      provenance: 'fallback',
      fallbackReason: null,
      message: fallbackMessage('invalid', plan, req.dateMs)
    };
  }
  return { proposals, provenance: 'ai', fallbackReason: null, message: null };
}
