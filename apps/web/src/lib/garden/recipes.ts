/**
 * Applying a bed recipe plugin to one bed, and the no-key "Fill this bed"
 * fallback. Pure: the caller passes frost dates, crops and occupancy.
 */

import type { BedRecipePlugin, BedRecipeStep } from '$lib/plugins/schemas';
import { successionIntervalDays } from '$lib/schedule/succession';
import { fitFootprint, footprintsOverlap } from './geometry';
import { t } from '$lib/i18n';
import { plantingOccupancy, shortDate } from './occupancy';
import { footprintForCount, plantCount, resolveSpacing } from './plantCount';
import type {
  BedLayout,
  Footprint,
  GardenCrop,
  OccupancyInterval,
  PlantSpacing,
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
  /** Language for skipped reasons and warnings; English when unset. */
  locale?: string | null;
  /** The crop's planting window (yyyy-mm-dd days) for these frost dates.
   *  When set, a sowing dated outside it is left out (#657). */
  plantingWindow?: (cropPluginId: string) => { earliest: string; latest: string } | null;
}

export type RecipeFit = { fits: true } | { fits: false; reason: string };

const DAY_MS = 86_400_000;
const SECTION_SNAP_IN = 6;
const PACKED_LENGTH_IN = 24;
const FOOTPRINT_STEP_IN = 6;

export function frostFreeDays(lastSpringFrostMs: number, firstFallFrostMs: number): number {
  return Math.round((firstFallFrostMs - lastSpringFrostMs) / DAY_MS);
}

/** Frost-free days (first fall minus last spring frost) inside the recipe's
 *  `frostFreeDays` range. Zone labels are never checked. */
export function recipeFits(
  recipe: BedRecipePlugin,
  frostFreeDays: number,
  locale?: string | null
): RecipeFit {
  const range = recipe.frostFreeDays;
  if (!range) return { fits: true };
  if (frostFreeDays < range.min) {
    return {
      fits: false,
      reason: t(locale, 'gardenlib.recipe.needsDays', { min: range.min, days: frostFreeDays })
    };
  }
  if (range.max !== undefined && frostFreeDays > range.max) {
    return {
      fits: false,
      reason: t(locale, 'gardenlib.recipe.upToDays', { max: range.max, days: frostFreeDays })
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

function isoDayOf(ms: number): string {
  return new Date(dayOf(ms)).toISOString().slice(0, 10);
}

/** #656: a scaled section is too narrow when either side is below both the
 *  section's size in the recipe's own bed and the crop's spacing, so a recipe
 *  written for a wider bed never squeezes a crop into a strip it can't grow
 *  in. Returns the inches needed and given on the short side, or null. */
export function sectionTooNarrow(
  scaled: Pick<Footprint, 'w_in' | 'l_in'>,
  reference: Pick<Footprint, 'w_in' | 'l_in'>,
  spacing: Pick<PlantSpacing, 'inRowIn' | 'rowIn'>
): { need: number; have: number } | null {
  const cropIn = Math.min(spacing.inRowIn, spacing.rowIn);
  for (const [have, ref] of [
    [scaled.w_in, reference.w_in],
    [scaled.l_in, reference.l_in]
  ] as const) {
    const need = Math.min(ref, cropIn);
    if (have + 1e-9 < need) return { need: Math.round(need), have: Math.round(have) };
  }
  return null;
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
  const { bed, locale } = ctx;
  const date = (ms: number) => shortDate(ms, locale);
  const skipped: RecipeApplication['skipped'] = [];
  const warnings: string[] = [];
  const placed: Placed[] = [];
  const stepEnds = new Map<number, { endMs: number; lastKey: string }>();

  if (recipe.bedSize.widthFt !== bed.widthFt || recipe.bedSize.lengthFt !== bed.lengthFt) {
    warnings.push(
      t(locale, 'gardenlib.recipe.scaled', {
        from: `${formatFt(recipe.bedSize.widthFt)}×${formatFt(recipe.bedSize.lengthFt)}`,
        to: `${formatFt(bed.widthFt)}×${formatFt(bed.lengthFt)}`
      })
    );
  }

  recipe.steps.forEach((step, stepIndex) => {
    const crop = resolveStepCrop(step, ctx.crops);
    if (!crop) {
      skipped.push({
        stepIndex,
        reason: t(locale, 'gardenlib.recipe.notInLibrary', { crop: step.cropPluginId })
      });
      return;
    }
    if (crop.pluginId !== step.cropPluginId) {
      warnings.push(
        t(locale, 'gardenlib.recipe.usedInstead', {
          crop: crop.displayName,
          original: step.cropPluginId
        })
      );
    }

    let baseMs: number;
    let followsKey: string | null = null;
    if (step.start.anchor === 'after-step') {
      const prior = stepEnds.get(step.start.afterStep ?? -1);
      if (!prior) {
        skipped.push({
          stepIndex,
          reason: t(locale, 'gardenlib.recipe.followsStep', {
            n: (step.start.afterStep ?? 0) + 1
          })
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
      intervalDays = step.successions.intervalDays ?? successionIntervalDays(crop.cropFamily);
      if (intervalDays <= 0) {
        warnings.push(t(locale, 'gardenlib.recipe.plantOnce', { crop: crop.displayName }));
      }
    }
    const count = intervalDays > 0 ? sowings : 1;
    const pattern = step.pattern ?? 'square';
    const spacing = resolveSpacing(crop, pattern);

    const stepPlaced: Placed[] = [];
    for (let k = 0; k < count; k++) {
      const sliceL = section.l / count;
      const slice = { ...section, y: section.y + k * sliceL, l: sliceL };
      const footprint = sectionFootprint(slice, bed);
      const plantingDateMs = addDays(baseMs, k * intervalDays);
      const key = k === 0 ? `s${stepIndex}` : `s${stepIndex}.${k}`;
      const cropName =
        k === 0
          ? crop.displayName
          : t(locale, 'gardenlib.recipe.cropSowing', { crop: crop.displayName, n: k + 1 });
      const narrow =
        spacing.mode === 'area'
          ? null
          : sectionTooNarrow(footprint, sectionFootprint(slice, recipe.bedSize), spacing);
      if (narrow) {
        skipped.push({
          stepIndex,
          reason: t(locale, 'gardenlib.recipe.tooNarrow', { crop: cropName, ...narrow })
        });
        continue;
      }
      const window = ctx.plantingWindow?.(crop.pluginId);
      const sownIso = isoDayOf(plantingDateMs);
      if (window && (sownIso < window.earliest || sownIso > window.latest)) {
        skipped.push({
          stepIndex,
          reason: t(locale, 'gardenlib.recipe.outsideWindow', {
            crop: cropName,
            date: date(plantingDateMs),
            earliest: date(Date.parse(`${window.earliest}T00:00:00Z`)),
            latest: date(Date.parse(`${window.latest}T00:00:00Z`))
          })
        });
        continue;
      }
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
        { firstFallFrostMs: ctx.firstFallFrostMs, lastSpringFrostMs: ctx.lastSpringFrostMs }
      );
      if (!interval) continue;
      if (interval.harvestStartMs > ctx.firstFallFrostMs) {
        skipped.push({
          stepIndex,
          reason: t(locale, 'gardenlib.recipe.notReady', {
            crop: cropName,
            date: date(plantingDateMs),
            frost: date(ctx.firstFallFrostMs)
          })
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
          reason: t(locale, 'gardenlib.recipe.noRoom', {
            crop: cropName,
            date: date(plantingDateMs),
            opens: date(clash.endMs)
          })
        });
        continue;
      }
      for (const other of placed) {
        if (
          timesOverlap(other.interval, interval) &&
          spacesOverlap(other.proposal.footprint, footprint)
        ) {
          warnings.push(
            t(locale, 'gardenlib.recipe.shares', {
              crop: crop.displayName,
              other: other.name,
              date: date(Math.min(other.interval.endMs, interval.endMs))
            })
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

export interface UnplacedCrop {
  cropPluginId: string;
  varietyDisplayName: string;
  plants: number | null;
}

export interface DeterministicFillPlan {
  proposals: ProposedPlanting[];
  /** The recipe the plan came from, or null when it packed planned crops. */
  recipe: { pluginId: string; displayName: string } | null;
  /** The recipe's own warnings and left-out steps, so the fallback says why
   *  a step is missing or why a strip is shared (#656). */
  notes: string[];
}

function sizeCloseness(recipe: BedRecipePlugin, bed: Pick<BedLayout, 'widthFt' | 'lengthFt'>) {
  const a = recipe.bedSize.widthFt * recipe.bedSize.lengthFt;
  const b = bed.widthFt * bed.lengthFt;
  return Math.min(a, b) / Math.max(a, b);
}

/** How close the bed's length-to-width ratio is to the recipe's, 0 to 1. */
function shapeCloseness(recipe: BedRecipePlugin, bed: Pick<BedLayout, 'widthFt' | 'lengthFt'>) {
  const a = recipe.bedSize.lengthFt / recipe.bedSize.widthFt;
  const b = bed.lengthFt / bed.widthFt;
  return Math.min(a, b) / Math.max(a, b);
}

/** Recipe plans whose plantings start on or after `dateMs`, best first:
 *  most plantings kept (steps too narrow for the bed or outside their
 *  planting window are already left out), then the closest bed shape, then
 *  the closest reference bed size. */
function rankRecipes(
  recipes: readonly BedRecipePlugin[],
  ctx: RecipeContext,
  dayMs: number
): Array<{ recipe: BedRecipePlugin; proposals: ProposedPlanting[]; notes: string[] }> {
  const ffd = frostFreeDays(ctx.lastSpringFrostMs, ctx.firstFallFrostMs);
  const ranked: Array<{
    recipe: BedRecipePlugin;
    proposals: ProposedPlanting[];
    notes: string[];
    shape: number;
    size: number;
  }> = [];
  for (const recipe of recipes) {
    if (!recipeFits(recipe, ffd).fits) continue;
    const app = applyRecipe(recipe, ctx);
    const kept = app.plantings.filter((p) => p.plantingDateMs >= dayMs);
    if (kept.length === 0) continue;
    const keys = new Set(kept.map((p) => p.key));
    const proposals = kept.map((p) => ({
      ...p,
      provenance: 'fallback' as const,
      followsKey: p.followsKey && keys.has(p.followsKey) ? p.followsKey : null
    }));
    const notes = [
      ...app.warnings,
      ...app.skipped.map((s) =>
        t(ctx.locale, 'garden.insp.stepLeftOut', { n: s.stepIndex + 1, reason: s.reason })
      )
    ];
    ranked.push({
      recipe,
      proposals,
      notes,
      shape: shapeCloseness(recipe, ctx.bed),
      size: sizeCloseness(recipe, ctx.bed)
    });
  }
  return ranked.sort(
    (a, b) =>
      b.proposals.length - a.proposals.length ||
      b.shape - a.shape ||
      b.size - a.size ||
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
      { firstFallFrostMs: ctx.firstFallFrostMs, lastSpringFrostMs: ctx.lastSpringFrostMs }
    );
    if (!timing || timing.harvestStartMs > ctx.firstFallFrostMs) return;
    const window = ctx.plantingWindow?.(crop.pluginId);
    const sownIso = isoDayOf(dayMs);
    if (window && (sownIso < window.earliest || sownIso > window.latest)) return;
    // #555: a crop sown by area has no plant count; it gets an even share of
    // the bed's length (never less than the packed strip).
    const areaShareIn =
      Math.floor(bedLIn / Math.max(1, unplaced.length) / FOOTPRINT_STEP_IN) * FOOTPRINT_STEP_IN;
    const want =
      spacing.mode === 'area'
        ? { w_in: bedWIn, l_in: Math.min(bedLIn, Math.max(PACKED_LENGTH_IN, areaShareIn)) }
        : item.plants && item.plants > 0
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
      recipe: { pluginId: best.recipe.pluginId, displayName: best.recipe.displayName },
      notes: best.notes
    };
  }
  return { proposals: packUnplaced(unplaced, ctx, dayMs), recipe: null, notes: [] };
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
