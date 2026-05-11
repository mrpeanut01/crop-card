/**
 * Season calendar engine (FR-01).
 *
 * Given a planting record + the crop plugin's DTM and growth-stage data,
 * derive the season's actionable events: emergence, spray windows, companion
 * planting triggers (Three Sisters), harvest window.
 *
 * Pure function over plain data — no DB or UI dependencies. The /today page
 * filters the engine's output by date; /plan can surface the full season.
 */

import type { CropPlugin, CompanionPlugin } from '$lib/plugins/schemas';
import type { Block, PlantingRecord } from '$lib/db/blocks';
import type { HarvestEvent } from '$lib/db/harvestEvents';
import type { ShadeSource } from '$lib/db/shadeSources';
import {
  resolveGrowthStageTable,
  resolvePerennialTemplate
} from '$lib/plugins/growthStageTemplates';
import {
  resolveCropAgronomy,
  resolveCastsShade,
  familyReferenceSeedsPerAcre as familyReferenceSeedsPerAcreFromDefaults
} from '$lib/plugins/familyDefaults';
import {
  projectStages,
  projectHarvestTargets,
  projectPerennialStages,
  projectPerennialHarvestTargets,
  type ProjectedStage
} from './stageProjection';
import {
  projectShadeImpacts,
  type ShadeEmitter,
  type ShadeImpact,
  type ShadeTarget
} from './shadeModel';
import { dayOfYear } from './solar';
import { geojsonCentroid } from '$lib/geo/area';

export type CalendarEventKind =
  | 'planting'
  | 'emergence'
  | 'stage-window'
  | 'spray-window'
  | 'companion-trigger'
  | 'harvest-window'
  | 'cover-termination'
  | 'orchard-task'
  | 'seasonal-task'
  | 'curing-progress'
  | 'curing-ready'
  | 'shade-window';

export interface CalendarEvent {
  kind: CalendarEventKind;
  blockId: string;
  /** Phase 12D: per-crop attribution. The plantingRecord's id (now crops.id)
   *  flows through here so [+ Schedule] from /today can promote the event
   *  into a Task tied to the right Crop, not just the block. */
  cropId?: string;
  cropPluginId: string;
  varietyDisplayName: string;
  /** Inclusive start (ms epoch). */
  startMs: number;
  /** Inclusive end (ms epoch). For point-events, equals startMs. */
  endMs: number;
  title: string;
  body?: string;
  detail?: Record<string, unknown>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Global emergence default moved to `plugins/familyDefaults.ts` (B5/B9).
// Three Sisters offsets remain inline pending B8 (companion-system plugin).
const THREE_SISTERS_OFFSETS = {
  beansAfterCornDays: 14,
  pumpkinsAfterBeansDays: 21
};

export interface EventContext {
  /**
   * Other plantings in the same block, oldest-first. Used to anchor
   * cover-crop termination at 14 days before the next non-cover planting
   * (FR-18). Pass an empty array when context isn't available.
   */
  blockPlantings?: ReadonlyArray<PlantingRecord>;
  /**
   * B8 — companion-system plugins (Three Sisters, etc.). When supplied,
   * the engine iterates systems whose `primaryFamily` matches the planted
   * crop and emits a `companion-trigger` event per member. When omitted,
   * a built-in legacy Three Sisters fallback fires for corn plantings so
   * the engine retains historic behavior in tests + clients that don't
   * (yet) thread the registry through.
   */
  companionSystems?: ReadonlyArray<CompanionPlugin>;
}

/**
 * Phase 14 (swim-lane shade markers). Block axis context for shade
 * derivation. The engine is intentionally agnostic to lat/lon; the v1
 * heuristic only uses east-west neighbor relations.
 */
export interface BlockAxes {
  blockId: string;
  eastWestIndex: number | null;
  northSouthIndex: number | null;
}

export interface ShadeImpactEvent extends CalendarEvent {
  kind: 'shade-window';
  detail: {
    /** Primary slot for back-compat with v1 consumers. */
    slot: 'am' | 'mid' | 'pm';
    /** All sample-hour slots that observed shadow on this target. */
    slots?: Array<'am' | 'mid' | 'pm'>;
    /** Source crop id when emitter is a crop, undefined for external sources. */
    shadingCropId?: string;
    /** Source block id when emitter is a crop, undefined for external sources. */
    shadingBlockId?: string;
    /** Display label for the source (variety name, tree-row name, etc.). */
    shadingVariety: string;
    /** Source id when emitter is an external shade source. */
    shadingSourceId?: string;
    /** Emitter kind: 'crop' | 'tree-row' | 'hedge' | 'building' | 'fence' | 'structure' | 'other'. */
    shadingSourceKind?: string;
    /** 0..1 intensity scaled by emitter opacity × canopy × density × geometry. */
    intensity: number;
  };
}

export function eventsForPlanting(
  planting: PlantingRecord,
  crop: CropPlugin,
  ctx: EventContext = {}
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  if (planting.plantingDate == null) return events;
  const plant = planting.plantingDate;

  events.push({
    kind: 'planting',
    blockId: planting.blockId,
    cropId: planting.id,
    cropPluginId: planting.cropPluginId,
    varietyDisplayName: planting.varietyDisplayName,
    startMs: plant,
    endMs: plant,
    title: `Plant ${planting.varietyDisplayName}`,
    detail: { cropFamily: crop.cropFamily }
  });

  // Emergence (B9 — resolver merges plugin plantingGuide.emergenceDays
  // with the global default).
  const agronomy = resolveCropAgronomy(crop);
  const emergence = agronomy.emergenceDays;
  events.push({
    kind: 'emergence',
    blockId: planting.blockId,
    cropId: planting.id,
    cropPluginId: planting.cropPluginId,
    varietyDisplayName: planting.varietyDisplayName,
    startMs: plant + emergence.min * DAY_MS,
    endMs: plant + emergence.max * DAY_MS,
    title: `Expected emergence: ${planting.varietyDisplayName}`,
    detail: { cropFamily: crop.cropFamily }
  });

  // Growth-stage projection (Phase 14 §growth-stages). When the variety's
  // resolved stage table is available, emit one stage-window event per stage.
  // Corn additionally derives its POST spray windows from the projected V2/V4
  // stages so /scout deeplinks (?windowStage=V2-V3) keep working.
  const stageTable = resolveGrowthStageTable(crop);
  const projected: ProjectedStage[] = stageTable
    ? projectStages(plant, stageTable, crop.daysToMaturity)
    : [];
  if (stageTable && projected.length) {
    for (const s of projected) {
      events.push({
        kind: 'stage-window',
        blockId: planting.blockId,
        cropId: planting.id,
        cropPluginId: planting.cropPluginId,
        varietyDisplayName: planting.varietyDisplayName,
        startMs: s.startMs,
        endMs: s.endMs,
        title: `${s.code} — ${s.name}`,
        body: s.inspect,
        detail: {
          stageCode: s.code,
          stageName: s.name,
          system: stageTable.system,
          bodyKind: s.bodyKind,
          isHarvestTargetStage: s.isHarvestTargetStage
        }
      });
    }
  }

  // B3 — plugin-declared spray windows. When `crop.sprayWindows` is set,
  // these emit alongside (or instead of) the legacy hardcoded family
  // branches below. New crops should declare their own; legacy corn /
  // cucurbit varieties keep working via the family branches that follow.
  const hasPluginSprayWindows = (crop.sprayWindows?.length ?? 0) > 0;
  if (hasPluginSprayWindows) {
    for (const w of crop.sprayWindows!) {
      let startMs: number;
      let endMs: number;
      if (w.anchor === 'stage' && w.stageCode) {
        const s = projected.find((p) => p.code === w.stageCode);
        if (s) {
          startMs = s.startMs + w.offsetDaysMin * DAY_MS;
          endMs = s.endMs + w.offsetDaysMax * DAY_MS;
        } else {
          startMs = plant + w.offsetDaysMin * DAY_MS;
          endMs = plant + w.offsetDaysMax * DAY_MS;
        }
      } else {
        const anchorMs = w.anchor === 'emergence' ? plant + emergence.min * DAY_MS : plant;
        startMs = anchorMs + w.offsetDaysMin * DAY_MS;
        endMs = anchorMs + w.offsetDaysMax * DAY_MS;
      }
      events.push({
        kind: 'spray-window',
        blockId: planting.blockId,
        cropId: planting.id,
        cropPluginId: planting.cropPluginId,
        varietyDisplayName: planting.varietyDisplayName,
        startMs,
        endMs,
        title: w.title,
        body: w.body,
        detail: { chemistryClass: w.chemistryClass, stage: w.stageCode, anchor: w.anchor }
      });
    }
  }

  if (crop.cropFamily === 'corn' && !hasPluginSprayWindows) {
    // Legacy fallback — corn varieties without a plugin-declared sprayWindows
    // still get the historic V2/V3 + V4/V6 derivations. Once every shipped
    // corn plugin carries `sprayWindows`, this whole branch can be deleted.
    const v2 = projected.find((s) => s.code === 'V2');
    const v4 = projected.find((s) => s.code === 'V4');
    const v6 = projected.find((s) => s.code === 'V6');
    events.push({
      kind: 'spray-window',
      blockId: planting.blockId,
      cropId: planting.id,
      cropPluginId: planting.cropPluginId,
      varietyDisplayName: planting.varietyDisplayName,
      startMs: v2 ? v2.startMs : plant + 18 * DAY_MS,
      endMs: v2 ? v2.endMs : plant + 22 * DAY_MS,
      title: 'POST broadleaf scout window (V2–V3)',
      body: 'Scout block; if ≥3 broadleaves per 10 sq ft, plan a 2,4-D spray. Block-level lockout if companions are co-planted.',
      detail: { stage: 'V2-V3' }
    });
    events.push({
      kind: 'spray-window',
      blockId: planting.blockId,
      cropId: planting.id,
      cropPluginId: planting.cropPluginId,
      varietyDisplayName: planting.varietyDisplayName,
      startMs: v4 ? v4.startMs : plant + 28 * DAY_MS,
      endMs: v6 ? v6.endMs : v4 ? v4.endMs : plant + 35 * DAY_MS,
      title: 'POST grass + late broadleaf window (V4–V6)',
      body: 'Window for Mesotrione + Stadia. Verify decon if sprayer last ran auxin.',
      detail: { stage: 'V4-V6' }
    });
  }

  // B8 — companion-system triggers. When the caller threads the companion
  // plugin registry through `ctx.companionSystems`, iterate systems whose
  // `primaryFamily` matches and emit one trigger per member. When no
  // registry is supplied, fall back to the legacy hardcoded Three Sisters
  // pair so unit tests + clients that haven't been updated still work.
  if (ctx.companionSystems?.length) {
    for (const sys of ctx.companionSystems) {
      if (!sys.primaryFamily || !sys.members?.length) continue;
      if (sys.primaryFamily !== crop.cropFamily) continue;
      for (const m of sys.members) {
        const memberStart = plant + (m.plantingOffsetDays - 1) * DAY_MS;
        const memberEnd = plant + (m.plantingOffsetDays + 2) * DAY_MS;
        events.push({
          kind: 'companion-trigger',
          blockId: planting.blockId,
          cropId: planting.id,
          cropPluginId: planting.cropPluginId,
          varietyDisplayName: planting.varietyDisplayName,
          startMs: memberStart,
          endMs: memberEnd,
          title: m.title ?? `${sys.displayName}: add ${m.role}`,
          body: m.body ?? sys.benefit,
          detail: { companionSystemId: sys.pluginId, memberFamily: m.family, memberRole: m.role }
        });
      }
    }
  } else if (crop.cropFamily === 'corn') {
    // Legacy Three Sisters fallback — preserved verbatim for back-compat
    // with engine tests + clients that don't (yet) pass companionSystems.
    events.push({
      kind: 'companion-trigger',
      blockId: planting.blockId,
      cropId: planting.id,
      cropPluginId: planting.cropPluginId,
      varietyDisplayName: planting.varietyDisplayName,
      startMs: plant + (THREE_SISTERS_OFFSETS.beansAfterCornDays - 1) * DAY_MS,
      endMs: plant + (THREE_SISTERS_OFFSETS.beansAfterCornDays + 2) * DAY_MS,
      title: 'Three Sisters: plant beans (corn at ~6 in)',
      body: 'Plant pole beans 6 in from each cornstalk. Avoid before corn reaches 6 in.'
    });
    events.push({
      kind: 'companion-trigger',
      blockId: planting.blockId,
      cropId: planting.id,
      cropPluginId: planting.cropPluginId,
      varietyDisplayName: planting.varietyDisplayName,
      startMs:
        plant +
        (THREE_SISTERS_OFFSETS.beansAfterCornDays + THREE_SISTERS_OFFSETS.pumpkinsAfterBeansDays) *
          DAY_MS,
      endMs:
        plant +
        (THREE_SISTERS_OFFSETS.beansAfterCornDays +
          THREE_SISTERS_OFFSETS.pumpkinsAfterBeansDays +
          3) *
          DAY_MS,
      title: 'Three Sisters: plant pumpkins on outer hills',
      body: 'Plant pumpkin hills at outer block edges so vines do not shade young corn or beans.'
    });
  }

  // Cucurbit POST grass window (Clethodim) — legacy fallback. Cucurbit
  // varieties that declare a Clethodim sprayWindow take precedence; this
  // branch can be removed once every cucurbit plugin carries its own.
  if (crop.cropFamily === 'cucurbit' && !hasPluginSprayWindows) {
    events.push({
      kind: 'spray-window',
      blockId: planting.blockId,
      cropId: planting.id,
      cropPluginId: planting.cropPluginId,
      varietyDisplayName: planting.varietyDisplayName,
      startMs: plant + 30 * DAY_MS,
      endMs: plant + 60 * DAY_MS,
      title: 'POST grass window (Clethodim)',
      body: 'For grass escapes in the pumpkin block. Verify sprayer never carried auxin without decon.'
    });
  }

  // Cover-crop termination ahead of any cash-crop succession (FR-18).
  // B4 — termination-lead minimum is now plugin-declared
  // (`agronomy.terminationLeadDaysMin`) with a family default of 14 days.
  if (agronomy.isCoverCrop) {
    const nextCashCrop = (ctx.blockPlantings ?? [])
      .filter(
        (p) => p.id !== planting.id && p.plantingDate != null && p.plantingDate > plant
        // The cash-crop check is family-aware in the caller; here we only
        // need "any other planting after this cover crop in the same block."
      )
      .sort((a, b) => a.plantingDate! - b.plantingDate!)[0];

    if (nextCashCrop) {
      // Spec FR-18: terminate ≥`leadMin` days before the next cash-crop plant
      // date. Window opens 7 days earlier than `leadMin` and closes at
      // `leadMin` — operator has a 7-day window to do the burndown.
      const leadMin = agronomy.terminationLeadDaysMin;
      events.push({
        kind: 'cover-termination',
        blockId: planting.blockId,
        cropId: planting.id,
        cropPluginId: planting.cropPluginId,
        varietyDisplayName: planting.varietyDisplayName,
        startMs: nextCashCrop.plantingDate! - (leadMin + 7) * DAY_MS,
        endMs: nextCashCrop.plantingDate! - leadMin * DAY_MS,
        title: `Terminate cover: ${planting.varietyDisplayName}`,
        body: `Burndown ≥${leadMin} days before ${nextCashCrop.varietyDisplayName} planting on ${new Date(nextCashCrop.plantingDate!).toLocaleDateString()}.`,
        detail: { nextCashCropPlantingId: nextCashCrop.id, anchorDate: nextCashCrop.plantingDate! }
      });
    } else {
      events.push({
        kind: 'cover-termination',
        blockId: planting.blockId,
        cropId: planting.id,
        cropPluginId: planting.cropPluginId,
        varietyDisplayName: planting.varietyDisplayName,
        startMs: plant + 180 * DAY_MS,
        endMs: plant + 195 * DAY_MS,
        title: `Terminate cover: ${planting.varietyDisplayName}`,
        body: 'No follow-up planting recorded yet — generic spring termination window. Add the next cash-crop planting to /plan to anchor this exactly.'
      });
    }
  }

  // Orchard seasonal tasks (FR-10) — perennial families render multi-year.
  // Each task fires once per calendar year on the plugin's `dayOfYear`.
  if (crop.cropFamily === 'orchard' && crop.orchardSeasonalTasks?.length) {
    const seasonYears = orchardSeasonYears(plant);
    for (const year of seasonYears) {
      for (const task of crop.orchardSeasonalTasks) {
        const start = dayOfYearToMs(year, task.dayOfYear);
        events.push({
          kind: 'orchard-task',
          blockId: planting.blockId,
          cropId: planting.id,
          cropPluginId: planting.cropPluginId,
          varietyDisplayName: planting.varietyDisplayName,
          startMs: start,
          endMs: start + (task.windowDays ?? 7) * DAY_MS,
          title: `${task.title} — ${planting.varietyDisplayName}`,
          body: task.body,
          detail: { taskKey: task.key, year }
        });
      }
    }
  }

  // Generic seasonalTasks (Phase 9) — works for any family. Perennial families
  // (orchard, stone-fruit, small-fruit, bramble, vine-fruit, forage) render
  // across the next 3 calendar years; annuals render only the planting year.
  if (crop.seasonalTasks?.length) {
    // B5 — perennial detection moved to resolveCropAgronomy(); plugins can
    // also explicitly declare `agronomy.lifecycle: 'perennial'` to opt in
    // outside the family default set.
    const years = agronomy.isPerennial ? orchardSeasonYears(plant) : [new Date(plant).getFullYear()];
    for (const year of years) {
      for (const task of crop.seasonalTasks) {
        const start = task.dayOfYear
          ? dayOfYearToMs(year, task.dayOfYear)
          : plant + (task.daysAfterPlanting ?? 0) * DAY_MS;
        events.push({
          kind: 'seasonal-task',
          blockId: planting.blockId,
          cropId: planting.id,
          cropPluginId: planting.cropPluginId,
          varietyDisplayName: planting.varietyDisplayName,
          startMs: start,
          endMs: start + (task.windowDays ?? 7) * DAY_MS,
          title: `${task.title} — ${planting.varietyDisplayName}`,
          body: task.body,
          detail: { taskKey: task.key, year, kind: task.kind }
        });
      }
    }
  }

  // Perennial calendar projection — stage-window events anchored on dayOfYear,
  // rendered for the same year-window as orchard/seasonal tasks.
  const perennialTemplate = resolvePerennialTemplate(crop);
  const perennialHarvestTargets: { startMs: number; endMs: number; label: string }[] = [];
  if (perennialTemplate) {
    const years = orchardSeasonYears(plant);
    for (const year of years) {
      const projP = projectPerennialStages(perennialTemplate, year);
      for (const s of projP) {
        events.push({
          kind: 'stage-window',
          blockId: planting.blockId,
          cropId: planting.id,
          cropPluginId: planting.cropPluginId,
          varietyDisplayName: planting.varietyDisplayName,
          startMs: s.startMs,
          endMs: s.endMs,
          title: `${s.name} — ${planting.varietyDisplayName}`,
          body: s.inspect,
          detail: {
            stageCode: s.code,
            stageName: s.name,
            system: 'perennial-calendar',
            bodyKind: s.bodyKind,
            isHarvestTargetStage: s.isHarvestTargetStage,
            year
          }
        });
      }
      const ph = projectPerennialHarvestTargets(perennialTemplate, projP);
      for (const t of ph) {
        perennialHarvestTargets.push({ startMs: t.startMs, endMs: t.endMs, label: t.label });
      }
    }
  }

  // Harvest window(s). Three sources, in priority order:
  //   1. Variety's resolved stage table — one harvest-window event per
  //      harvest target (dual-purpose corn yields two: R3 sweet, R6 dent).
  //   2. Perennial template — one harvest-window event per season year.
  //   3. Legacy DTM-only fallback when neither stage data resolves.
  if (stageTable && projected.length) {
    const harvestTargets = projectHarvestTargets(projected, stageTable);
    for (const t of harvestTargets) {
      events.push({
        kind: 'harvest-window',
        blockId: planting.blockId,
        cropId: planting.id,
        cropPluginId: planting.cropPluginId,
        varietyDisplayName: planting.varietyDisplayName,
        startMs: t.startMs,
        endMs: t.endMs,
        title: `Harvest target — ${t.label}: ${planting.varietyDisplayName}`,
        body: 'Use crop-specific readiness indicators before harvest.',
        detail: {
          stageCode: t.stageCode,
          label: t.label,
          useCase: t.useCase,
          dtmMin: crop.daysToMaturity?.min,
          dtmMax: crop.daysToMaturity?.max
        }
      });
    }
  } else if (perennialHarvestTargets.length) {
    for (const t of perennialHarvestTargets) {
      events.push({
        kind: 'harvest-window',
        blockId: planting.blockId,
        cropId: planting.id,
        cropPluginId: planting.cropPluginId,
        varietyDisplayName: planting.varietyDisplayName,
        startMs: t.startMs,
        endMs: t.endMs,
        title: `Harvest window: ${planting.varietyDisplayName}`,
        body: 'Use crop-specific readiness indicators before harvest.',
        detail: { label: t.label }
      });
    }
  } else {
    const dtm = crop.daysToMaturity;
    if (dtm) {
      events.push({
        kind: 'harvest-window',
        blockId: planting.blockId,
        cropId: planting.id,
        cropPluginId: planting.cropPluginId,
        varietyDisplayName: planting.varietyDisplayName,
        startMs: plant + dtm.min * DAY_MS,
        endMs: plant + dtm.max * DAY_MS,
        title: `Harvest window: ${planting.varietyDisplayName}`,
        body: 'Use crop-specific readiness indicators before harvest.',
        detail: { dtmMin: dtm.min, dtmMax: dtm.max }
      });
    }
  }

  return events;
}

/** For an orchard planting at `plantedAtMs`, the years we render seasonal
 *  tasks for: this calendar year, plus the next 2 (perennial). */
function orchardSeasonYears(plantedAtMs: number): number[] {
  const start = new Date(plantedAtMs).getFullYear();
  return [start, start + 1, start + 2];
}

function dayOfYearToMs(year: number, dayOfYear: number): number {
  // Day 1 = January 1 at local midnight.
  const d = new Date(year, 0, 1);
  d.setDate(d.getDate() + (dayOfYear - 1));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Curing reminders for FR-08. After a harvest is recorded, emit:
 *   - a `curing-progress` event from harvest-date → harvest-date + min weeks
 *   - a `curing-ready` window from harvest-date + min weeks → + max weeks
 * Operators see the curing card on /today + /harvest with the countdown.
 */
export function eventsForHarvest(harvest: HarvestEvent, crop: CropPlugin): CalendarEvent[] {
  const curing = crop.postHarvestCuring;
  if (!curing) return [];
  const out: CalendarEvent[] = [];
  const start = harvest.occurredAt;
  const minMs = start + curing.durationWeeks.min * 7 * DAY_MS;
  const maxMs = start + curing.durationWeeks.max * 7 * DAY_MS;

  out.push({
    kind: 'curing-progress',
    blockId: harvest.blockId,
    cropId: harvest.cropId,
    cropPluginId: harvest.cropPluginId,
    varietyDisplayName: crop.displayName,
    startMs: start,
    endMs: minMs,
    title: `Curing in progress: ${crop.displayName}`,
    body: curing.method
      ? `Method: ${curing.method}. Min ${curing.durationWeeks.min} wk${curing.durationWeeks.min === 1 ? '' : 's'}.`
      : undefined,
    detail: {
      harvestEventId: harvest.id,
      lotNumber: harvest.lotNumber,
      method: curing.method,
      targetMoisturePercent: curing.targetMoisturePercent
    }
  });

  out.push({
    kind: 'curing-ready',
    blockId: harvest.blockId,
    cropId: harvest.cropId,
    cropPluginId: harvest.cropPluginId,
    varietyDisplayName: crop.displayName,
    startMs: minMs,
    endMs: maxMs,
    title: `Curing ready: ${crop.displayName}`,
    body: curing.targetMoisturePercent
      ? `Verify moisture ${curing.targetMoisturePercent.min}-${curing.targetMoisturePercent.max}% before storage.`
      : 'Verify by feel + visual check before transferring to storage.',
    detail: { harvestEventId: harvest.id, lotNumber: harvest.lotNumber }
  });

  return out;
}

/**
 * v2 shade window factory (Phase 14 §shade-model).
 *
 * Computes shadow impacts for the union of:
 *   - shade-casting crops (height ≥ 5 ft, family-corn fallback, or explicit
 *     `shadeCasting: true` on the plugin)
 *   - external shade sources (tree rows, hedges, buildings, fences) loaded
 *     from the `shade_sources` table
 *
 * Inputs include block geometry (centroid + footprint, when present) and
 * optional terrain slope per block, fed into shadeModel.ts which performs
 * the solar geometry + density + canopy + slope projection. Falls back to
 * eastWestIndex/northSouthIndex adjacency when geometry is absent so v1-era
 * blocks (no polygon drawn) still produce reasonable hints.
 *
 * Returns CalendarEvent[] kind='shade-window' — same shape as v1 so the UI
 * doesn't need to change. The event detail.slot is now 'am' | 'mid' | 'pm'.
 */
export interface ShadeWindowInput {
  plantings: ReadonlyArray<{ planting: PlantingRecord; crop: CropPlugin; block: Block }>;
  shadeSources: ReadonlyArray<ShadeSource>;
  blocks: ReadonlyArray<Block>;
  farmLat: number;
  farmLon: number;
  fromMs: number;
  toMs: number;
}

export function computeShadeWindowEvents(input: ShadeWindowInput): ShadeImpactEvent[] {
  const emitters: ShadeEmitter[] = [];

  for (const { planting, crop, block } of input.plantings) {
    const e = buildEmitterFromCrop(planting, crop, block);
    if (e) emitters.push(e);
  }

  const renderYear = new Date(input.fromMs).getFullYear();
  for (const source of input.shadeSources) {
    const e = buildEmitterFromShadeSource(source, renderYear);
    if (e) emitters.push(e);
  }

  const targets: ShadeTarget[] = input.blocks.map(buildShadeTarget);
  const impacts = projectShadeImpacts({
    emitters,
    targets,
    farmLat: input.farmLat,
    farmLon: input.farmLon,
    fromMs: input.fromMs,
    toMs: input.toMs
  });

  return impacts.map(impactToEvent);
}

function buildEmitterFromCrop(
  planting: PlantingRecord,
  crop: CropPlugin,
  block: Block
): ShadeEmitter | null {
  if (planting.plantingDate == null) return null;
  if (!cropCastsShade(crop)) return null;
  const heightFt = crop.matureHeightFt ?? 6;
  if (heightFt <= 0) return null;
  const dtmMax = crop.daysToMaturity?.max ?? crop.daysToMaturity?.min ?? 0;
  if (dtmMax <= 0) return null;
  const plant = planting.plantingDate;
  const canopyStartMs = plant + Math.floor((dtmMax / 2) * DAY_MS);
  const canopyEndMs = plant + dtmMax * DAY_MS;

  return {
    id: `crop:${planting.id}`,
    kind: 'crop',
    displayName: planting.varietyDisplayName,
    sourceBlockId: planting.blockId,
    sourceCropId: planting.id,
    centroidLonLat: geojsonCentroid(block.geometryGeojson) ??
      synthCentroidFromIndices(block),
    footprint: null,
    heightFt,
    opacity: 0.85,
    densityMultiplier: cropDensityMultiplier(crop),
    canopyAtMs: cropCanopyFractionFor(crop, planting.plantingDate),
    canopyStartMs,
    canopyEndMs
  };
}

function buildEmitterFromShadeSource(source: ShadeSource, year: number): ShadeEmitter | null {
  if (source.heightFt <= 0 || source.opacity <= 0) return null;
  // Clamp the rendered band to the leaf-on / leaf-off window for deciduous
  // sources (band only shows when there's meaningful canopy). Evergreens get
  // the full year via the default fall-through in shadeModel.clampWindow.
  const canopyStartMs = source.isDeciduous
    ? dayOfYearToMs(year, source.leafOnDayOfYear)
    : undefined;
  const canopyEndMs = source.isDeciduous
    ? dayOfYearToMs(year, source.leafOffDayOfYear)
    : undefined;
  return {
    id: `source:${source.id}`,
    kind: source.kind,
    displayName: source.name,
    sourceBlockId: null,
    sourceCropId: null,
    centroidLonLat: geojsonCentroid(source.geometryGeojson),
    footprint: null,
    heightFt: source.heightFt,
    opacity: source.opacity,
    densityMultiplier: 1,
    canopyAtMs: source.isDeciduous
      ? deciduousCanopyFor(source.leafOnDayOfYear, source.leafOffDayOfYear)
      : () => 1,
    canopyStartMs,
    canopyEndMs
  };
}

function buildShadeTarget(block: Block): ShadeTarget {
  return {
    blockId: block.id,
    centroidLonLat: geojsonCentroid(block.geometryGeojson),
    footprint: null,
    eastWestIndex: block.eastWestIndex ?? null,
    northSouthIndex: block.northSouthIndex ?? null,
    slopePercent: block.slopePercent ?? null,
    slopeAspectDeg: block.slopeAspectDeg ?? null
  };
}

function impactToEvent(i: ShadeImpact): ShadeImpactEvent {
  // Choose a primary slot for back-compat: AM if observed, else PM, else MID.
  const slot: 'am' | 'mid' | 'pm' =
    i.slots.includes('am') ? 'am' : i.slots.includes('pm') ? 'pm' : 'mid';
  const intensityPct = Math.round(i.intensity * 100);
  return {
    kind: 'shade-window',
    blockId: i.blockId,
    cropId: undefined,
    cropPluginId: i.sourceCropId ? `__shade__:${i.emitterId}` : `__shade-source__:${i.emitterId}`,
    varietyDisplayName: i.emitterLabel,
    startMs: i.startMs,
    endMs: i.endMs,
    title: `Shade from ${i.emitterLabel} (${intensityPct}%)`,
    body: shadeBodyText(i),
    detail: {
      slot,
      slots: i.slots,
      shadingCropId: i.sourceCropId ?? undefined,
      shadingBlockId: i.sourceBlockId ?? undefined,
      shadingVariety: i.emitterLabel,
      shadingSourceId: i.sourceCropId ? undefined : i.emitterId,
      shadingSourceKind: i.emitterKind,
      intensity: i.intensity
    }
  };
}

function shadeBodyText(i: ShadeImpact): string {
  const slotsLabel = i.slots
    .map((s) => (s === 'am' ? 'morning' : s === 'pm' ? 'afternoon' : 'midday'))
    .join(' + ');
  return `Shadow from ${i.emitterLabel} reaches this block (${slotsLabel}).`;
}

/**
 * Crop canopy fraction at a given date — uses growthStageTable when present,
 * else linear ramp 0→1 across the DTM. Returns 0 outside the active window.
 */
function cropCanopyFractionFor(
  crop: CropPlugin,
  plantingDateMs: number
): (dateMs: number) => number {
  const dtmMax = crop.daysToMaturity?.max ?? crop.daysToMaturity?.min ?? 0;
  return (dateMs: number) => {
    const days = (dateMs - plantingDateMs) / DAY_MS;
    if (dtmMax <= 0) return 0;
    if (days <= 0) return 0;
    if (days >= dtmMax) return 0.85; // canopy thinning post-maturity
    // Sigmoid-ish ramp: 0 at plant, 1 at half-DTM, plateau through DTM.
    const half = dtmMax / 2;
    if (days < half) return Math.max(0, days / half);
    return 1;
  };
}

/**
 * Density multiplier from `plantingGuide.seedsPerAcre` against a family
 * reference. Falls back to 1.0 when seedsPerAcre is absent. Output ∈
 * [0.5, 1.5].
 */
function cropDensityMultiplier(crop: CropPlugin): number {
  // B6 — prefer per-plugin reference density; fall through to family.
  const sp = crop.plantingGuide?.seedsPerAcre;
  const ref =
    crop.plantingGuide?.referenceDensitySeedsPerAcre ??
    familyReferenceSeedsPerAcreFromDefaults(crop.cropFamily);
  if (!sp || !ref) return 1;
  const ratio = sp / ref;
  return Math.max(0.5, Math.min(1.5, ratio));
}

/**
 * Deciduous canopy fraction by date. Inside leaf-on..leaf-off window: 1.
 * Outside: 0.15 (bare branches still block ~15% of light).
 */
function deciduousCanopyFor(
  leafOnDoy: number,
  leafOffDoy: number
): (dateMs: number) => number {
  return (dateMs: number) => {
    const doy = dayOfYear(dateMs);
    if (leafOnDoy <= leafOffDoy) {
      return doy >= leafOnDoy && doy <= leafOffDoy ? 1 : 0.15;
    }
    // Wraps year boundary (e.g., evergreen-ish southern bloom — not typical).
    return doy >= leafOnDoy || doy <= leafOffDoy ? 1 : 0.15;
  };
}

/**
 * When a block has eastWestIndex/northSouthIndex but no geometry, synthesize
 * a [lon, lat] near the farm's lat/lon by treating each index unit as ~25m
 * E or N. Only used by the index-fallback path when both source and target
 * are missing geometry.
 *
 * Note: returns null when neither index is set, so callers fall through to
 * the pure-axis fallback inside shadeModel.
 */
function synthCentroidFromIndices(block: Block): [number, number] | null {
  if (block.eastWestIndex == null && block.northSouthIndex == null) return null;
  // We don't have access to farm lat/lon here so we encode indices as a
  // synthetic (lon, lat) at (0, 0); the shadeModel detects the lack of
  // real geometry by checking centroidLonLat==null and falls back to its
  // axis-distance heuristic. So return null here and let that path run.
  return null;
}

export function cropCastsShade(crop: CropPlugin): boolean {
  // B7 — delegated to `resolveCastsShade`. Behavior preserved: plugin
  // `shadeCasting` / `matureHeightFt` win, then a small family-default set
  // (today: corn) handles legacy plugins that haven't declared either.
  return resolveCastsShade(crop);
}

export function eventsInRange(
  events: CalendarEvent[],
  fromMs: number,
  toMs: number
): CalendarEvent[] {
  return events
    .filter((e) => e.endMs >= fromMs && e.startMs <= toMs)
    .sort((a, b) => a.startMs - b.startMs);
}

export function eventsToday(events: CalendarEvent[], now: number = Date.now()): CalendarEvent[] {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);
  return eventsInRange(events, dayStart.getTime(), dayEnd.getTime());
}

export function upcomingEvents(
  events: CalendarEvent[],
  windowDays: number = 14,
  now: number = Date.now()
): CalendarEvent[] {
  return eventsInRange(events, now, now + windowDays * DAY_MS);
}
