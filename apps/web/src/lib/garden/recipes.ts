/**
 * Applying a bed recipe plugin to one bed, and the no-key "Fill this bed"
 * fallback. Pure: the caller passes frost dates, crops and occupancy.
 */

import type { BedRecipePlugin, BedRecipeStep } from '$lib/plugins/schemas';
import { FAMILY_SUCCESSION_DAYS } from '$lib/schedule/succession';
import { fitFootprint, footprintsOverlap } from './geometry';
import { plantingOccupancy } from './occupancy';
import { footprintForCount, plantCount, resolveSpacing } from './plantCount';
import type {
  BedLayout,
  Footprint,
  GardenCrop,
  OccupancyInterval,
  ProposedPlanting,
  RecipeApplication
} from './types';

export type { BedRecipePlugin };

export interface RecipeContext {
  bed: Pick<BedLayout, 'blockId' | 'widthFt' | 'lengthFt'>;
  crops: Readonly<Record<string, GardenCrop>>;
  lastSpringFrostMs: number;
  firstFallFrostMs: number;
  /** Existing intervals on this bed; recipe steps never overlap them. */
  intervals: readonly OccupancyInterval[];
  seasonYear: number;
}

export type RecipeFit = { fits: true } | { fits: false; reason: string };

const DAY_MS = 86_400_000;
const SECTION_SNAP_IN = 6;
const PACKED_LENGTH_IN = 24;

export function frostFreeDays(lastSpringFrostMs: number, firstFallFrostMs: number): number {
  return Math.round((firstFallFrostMs - lastSpringFrostMs) / DAY_MS);
}

/** Frost-free days (first fall minus last spring frost) inside the recipe's
 *  `frostFreeDays` range. Zone labels are never checked. */
export function recipeFits(recipe: BedRecipePlugin, frostFreeDays: number): RecipeFit {
  const range = recipe.frostFreeDays;
  if (!range) return { fits: true };
  if (frostFreeDays < range.min) {
    return {
      fits: false,
      reason: `Needs about ${range.min} frost-free days. Your season has ${frostFreeDays}.`
    };
  }
  if (range.max !== undefined && frostFreeDays > range.max) {
    return {
      fits: false,
      reason: `Made for seasons up to ${range.max} frost-free days. Yours has ${frostFreeDays}.`
    };
  }
  return { fits: true };
}

function addDays(ms: number, days: number): number {
  return ms + days * DAY_MS;
}

/** Nearest UTC midnight. Designer dates are UTC days, and frost dates read
 *  as local midnight land on the same day. */
export function dayOf(ms: number): number {
  return Math.round(ms / DAY_MS) * DAY_MS;
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

function formatFt(ft: number): string {
  return Number.isInteger(ft) ? String(ft) : ft.toFixed(1);
}

function snapIn(value: number): number {
  return Math.round(value / SECTION_SNAP_IN) * SECTION_SNAP_IN;
}

function span(start: number, size: number, total: number): [number, number] {
  const a = Math.min(Math.max(snapIn(start * total), 0), total);
  const b = Math.min(Math.max(snapIn((start + size) * total), 0), total);
  const len = Math.max(Math.min(SECTION_SNAP_IN, total), b - a);
  return [Math.max(0, Math.min(a, total - len)), len];
}

/** A recipe section (fractions of the bed) in the bed's own inches, snapped
 *  to 6 in and kept inside the bed. */
export function sectionFootprint(
  section: { x: number; y: number; w: number; l: number },
  bed: Pick<BedLayout, 'widthFt' | 'lengthFt'>
): Footprint {
  const [x_in, w_in] = span(section.x, section.w, bed.widthFt * 12);
  const [y_in, l_in] = span(section.y, section.l, bed.lengthFt * 12);
  return { x_in, y_in, w_in, l_in };
}

function wholeBed(bed: Pick<BedLayout, 'widthFt' | 'lengthFt'>): Footprint {
  return { x_in: 0, y_in: 0, w_in: bed.widthFt * 12, l_in: bed.lengthFt * 12 };
}

function timesOverlap(
  a: { startMs: number; endMs: number },
  b: { startMs: number; endMs: number }
) {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

function spacesOverlap(a: Footprint | null, b: Footprint | null): boolean {
  if (!a || !b) return true;
  return footprintsOverlap(a, b);
}

function resolveStepCrop(
  step: BedRecipeStep,
  crops: Readonly<Record<string, GardenCrop>>
): GardenCrop | null {
  for (const id of [step.cropPluginId, ...step.alternates]) {
    const crop = crops[id];
    if (crop) return crop;
  }
  return null;
}

interface Placed {
  proposal: ProposedPlanting;
  interval: OccupancyInterval;
  name: string;
}

/** Scales each step's section to the bed, resolves the first registered
 *  crop among `cropPluginId` and `alternates`, dates it from its anchor and
 *  expands `successions`. Successions split the step's section into equal
 *  slices along the bed's length, one per sowing. Proposals carry `plugin`
 *  provenance; steps that cannot be placed land in `skipped`. */
export function applyRecipe(recipe: BedRecipePlugin, ctx: RecipeContext): RecipeApplication {
  const { bed } = ctx;
  const skipped: RecipeApplication['skipped'] = [];
  const warnings: string[] = [];
  const placed: Placed[] = [];
  const stepEnds = new Map<number, { endMs: number; lastKey: string }>();

  if (recipe.bedSize.widthFt !== bed.widthFt || recipe.bedSize.lengthFt !== bed.lengthFt) {
    warnings.push(
      `Written for a ${formatFt(recipe.bedSize.widthFt)}×${formatFt(recipe.bedSize.lengthFt)} ft bed and scaled to this ${formatFt(bed.widthFt)}×${formatFt(bed.lengthFt)} ft bed.`
    );
  }

  recipe.steps.forEach((step, stepIndex) => {
    const crop = resolveStepCrop(step, ctx.crops);
    if (!crop) {
      skipped.push({
        stepIndex,
        reason: `${step.cropPluginId} isn't in your crop library, and neither are its alternates.`
      });
      return;
    }
    if (crop.pluginId !== step.cropPluginId) {
      warnings.push(`Used ${crop.displayName} in place of ${step.cropPluginId}.`);
    }

    let baseMs: number;
    let followsKey: string | null = null;
    if (step.start.anchor === 'after-step') {
      const prior = stepEnds.get(step.start.afterStep ?? -1);
      if (!prior) {
        skipped.push({
          stepIndex,
          reason: `Follows step ${(step.start.afterStep ?? 0) + 1}, which could not be placed.`
        });
        return;
      }
      baseMs = addDays(dayOf(prior.endMs), step.start.offsetDays);
      followsKey = prior.lastKey;
    } else {
      const anchorMs =
        step.start.anchor === 'last-spring-frost' ? ctx.lastSpringFrostMs : ctx.firstFallFrostMs;
      baseMs = addDays(dayOf(anchorMs), step.start.offsetDays);
    }

    const section = step.section ?? { x: 0, y: 0, w: 1, l: 1 };
    const sowings = 1 + (step.successions?.count ?? 0);
    let intervalDays = 0;
    if (step.successions) {
      intervalDays = step.successions.intervalDays ?? familyInterval(crop.cropFamily);
      if (intervalDays <= 0) {
        warnings.push(`${crop.displayName} doesn't usually succession-sow, so it is planted once.`);
      }
    }
    const count = intervalDays > 0 ? sowings : 1;
    const pattern = step.pattern ?? 'square';
    const spacing = resolveSpacing(crop, pattern);

    const stepPlaced: Placed[] = [];
    for (let k = 0; k < count; k++) {
      const sliceL = section.l / count;
      const footprint = sectionFootprint({ ...section, y: section.y + k * sliceL, l: sliceL }, bed);
      const plantingDateMs = addDays(baseMs, k * intervalDays);
      const key = k === 0 ? `s${stepIndex}` : `s${stepIndex}.${k}`;
      const interval = plantingOccupancy(
        {
          cropId: key,
          blockId: bed.blockId,
          cropPluginId: crop.pluginId,
          status: 'planned',
          plantingDateMs,
          harvestedAtMs: null,
          footprint
        },
        crop,
        { firstFallFrostMs: ctx.firstFallFrostMs }
      );
      if (!interval) continue;
      const label = k === 0 ? '' : ` (sowing ${k + 1})`;
      if (interval.harvestStartMs > ctx.firstFallFrostMs) {
        skipped.push({
          stepIndex,
          reason: `${crop.displayName}${label} sown ${shortDate(plantingDateMs)} would not be ready before the first fall frost on ${shortDate(ctx.firstFallFrostMs)}.`
        });
        continue;
      }
      const clash = ctx.intervals.find(
        (i) =>
          i.blockId === bed.blockId &&
          timesOverlap(i, interval) &&
          spacesOverlap(i.footprint, footprint)
      );
      if (clash) {
        skipped.push({
          stepIndex,
          reason: `No room for ${crop.displayName}${label} on ${shortDate(plantingDateMs)}. That part of the bed opens ${shortDate(clash.endMs)}.`
        });
        continue;
      }
      for (const other of placed) {
        if (
          timesOverlap(other.interval, interval) &&
          spacesOverlap(other.proposal.footprint, footprint)
        ) {
          warnings.push(
            `${crop.displayName} shares space with ${other.name} until ${shortDate(Math.min(other.interval.endMs, interval.endMs))}.`
          );
        }
      }
      const proposal: ProposedPlanting = {
        key,
        blockId: bed.blockId,
        cropPluginId: crop.pluginId,
        varietyDisplayName: crop.displayName,
        plantingDateMs,
        footprint,
        spacing,
        plantCount: plantCount(footprint, spacing).count,
        provenance: 'plugin',
        note: k === 0 ? (step.note ?? null) : null,
        followsKey:
          k === 0 ? followsKey : (stepPlaced[stepPlaced.length - 1]?.proposal.key ?? followsKey)
      };
      const entry = { proposal, interval, name: crop.displayName };
      stepPlaced.push(entry);
      placed.push(entry);
    }

    if (stepPlaced.length > 0) {
      const last = stepPlaced.reduce((a, b) => (b.interval.endMs > a.interval.endMs ? b : a));
      stepEnds.set(stepIndex, { endMs: last.interval.endMs, lastKey: last.proposal.key });
    }
  });

  return {
    recipePluginId: recipe.pluginId,
    blockId: bed.blockId,
    plantings: placed.map((p) => p.proposal),
    skipped,
    warnings
  };
}

function familyInterval(family: string): number {
  return (FAMILY_SUCCESSION_DAYS as Readonly<Record<string, number>>)[family] ?? 0;
}

export interface UnplacedCrop {
  cropPluginId: string;
  varietyDisplayName: string;
  plants: number | null;
}

export interface DeterministicFillPlan {
  proposals: ProposedPlanting[];
  /** The recipe the plan came from, or null when it packed planned crops. */
  recipe: { pluginId: string; displayName: string } | null;
}

function sizeCloseness(recipe: BedRecipePlugin, bed: Pick<BedLayout, 'widthFt' | 'lengthFt'>) {
  const a = recipe.bedSize.widthFt * recipe.bedSize.lengthFt;
  const b = bed.widthFt * bed.lengthFt;
  return Math.min(a, b) / Math.max(a, b);
}

/** Recipe plans whose plantings start on or after `dateMs`, best first:
 *  most plantings kept, then the closest reference bed size. */
function rankRecipes(
  recipes: readonly BedRecipePlugin[],
  ctx: RecipeContext,
  dayMs: number
): Array<{ recipe: BedRecipePlugin; proposals: ProposedPlanting[] }> {
  const ffd = frostFreeDays(ctx.lastSpringFrostMs, ctx.firstFallFrostMs);
  const ranked: Array<{ recipe: BedRecipePlugin; proposals: ProposedPlanting[]; score: number }> =
    [];
  for (const recipe of recipes) {
    if (!recipeFits(recipe, ffd).fits) continue;
    const kept = applyRecipe(recipe, ctx).plantings.filter((p) => p.plantingDateMs >= dayMs);
    if (kept.length === 0) continue;
    const keys = new Set(kept.map((p) => p.key));
    const proposals = kept.map((p) => ({
      ...p,
      provenance: 'fallback' as const,
      followsKey: p.followsKey && keys.has(p.followsKey) ? p.followsKey : null
    }));
    ranked.push({ recipe, proposals, score: sizeCloseness(recipe, ctx.bed) });
  }
  return ranked.sort(
    (a, b) =>
      b.proposals.length - a.proposals.length ||
      b.score - a.score ||
      a.recipe.pluginId.localeCompare(b.recipe.pluginId)
  );
}

function packUnplaced(
  unplaced: readonly UnplacedCrop[],
  ctx: RecipeContext,
  dayMs: number
): ProposedPlanting[] {
  const { bed } = ctx;
  const bedWIn = bed.widthFt * 12;
  const bedLIn = bed.lengthFt * 12;
  const out: ProposedPlanting[] = [];
  const packed: Array<{ startMs: number; endMs: number; footprint: Footprint }> = [];
  unplaced.forEach((item, i) => {
    const crop = ctx.crops[item.cropPluginId];
    if (!crop) return;
    const spacing = resolveSpacing(crop, 'square');
    const timing = plantingOccupancy(
      {
        cropId: `p${i}`,
        blockId: bed.blockId,
        cropPluginId: crop.pluginId,
        status: 'planned',
        plantingDateMs: dayMs,
        harvestedAtMs: null,
        footprint: null
      },
      crop,
      { firstFallFrostMs: ctx.firstFallFrostMs }
    );
    if (!timing || timing.harvestStartMs > ctx.firstFallFrostMs) return;
    const want =
      item.plants && item.plants > 0
        ? footprintForCount(item.plants, spacing, bedWIn)
        : { w_in: bedWIn, l_in: Math.min(PACKED_LENGTH_IN, bedLIn) };
    const taken: Footprint[] = [
      ...ctx.intervals
        .filter((iv) => iv.blockId === bed.blockId && timesOverlap(iv, timing))
        .map((iv) => iv.footprint ?? wholeBed(bed)),
      ...packed.filter((p) => timesOverlap(p, timing)).map((p) => p.footprint)
    ];
    const footprint = fitFootprint(
      bed,
      { w_in: Math.min(want.w_in, bedWIn), l_in: Math.min(want.l_in, bedLIn) },
      taken
    );
    if (!footprint) return;
    packed.push({ startMs: timing.startMs, endMs: timing.endMs, footprint });
    out.push({
      key: `p${i}`,
      blockId: bed.blockId,
      cropPluginId: crop.pluginId,
      varietyDisplayName: item.varietyDisplayName,
      plantingDateMs: dayMs,
      footprint,
      spacing,
      plantCount: plantCount(footprint, spacing).count,
      provenance: 'fallback',
      note: null,
      followsKey: null
    });
  });
  return out;
}

/** `deterministicFill` plus which recipe it used, for the banner copy. */
export function deterministicFillPlan(
  recipes: readonly BedRecipePlugin[],
  unplaced: readonly UnplacedCrop[],
  ctx: RecipeContext,
  dateMs: number
): DeterministicFillPlan {
  const dayMs = dayOf(dateMs);
  const best = rankRecipes(recipes, ctx, dayMs)[0];
  if (best) {
    return {
      proposals: best.proposals,
      recipe: { pluginId: best.recipe.pluginId, displayName: best.recipe.displayName }
    };
  }
  return { proposals: packUnplaced(unplaced, ctx, dayMs), recipe: null };
}

/** What "Fill this bed" returns without Claude: the best-fitting recipe's
 *  application when one fits the bed and season, otherwise the owner's
 *  unplaced planned crops packed into the free space on `dateMs` by
 *  spacing. Proposals carry `fallback` provenance. */
export function deterministicFill(
  recipes: readonly BedRecipePlugin[],
  unplaced: ReadonlyArray<{
    cropPluginId: string;
    varietyDisplayName: string;
    plants: number | null;
  }>,
  ctx: RecipeContext,
  dateMs: number
): ProposedPlanting[] {
  return deterministicFillPlan(recipes, unplaced, ctx, dateMs).proposals;
}
