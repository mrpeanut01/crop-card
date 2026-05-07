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

import type { CropPlugin } from '$lib/plugins/schemas';
import type { PlantingRecord } from '$lib/db/blocks';
import type { HarvestEvent } from '$lib/db/harvestEvents';

export type CalendarEventKind =
  | 'planting'
  | 'emergence'
  | 'spray-window'
  | 'companion-trigger'
  | 'harvest-window'
  | 'cover-termination'
  | 'orchard-task'
  | 'seasonal-task'
  | 'curing-progress'
  | 'curing-ready';

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

/** Heuristic emergence window for crops that don't declare one. */
const DEFAULT_EMERGENCE_DAYS = { min: 7, max: 14 };

/**
 * Three Sisters companion trigger: pole beans planted ~14 days after corn
 * reaches 6 in (V2-ish), and pumpkins ~7 days after beans germinate. We
 * approximate with day offsets relative to the corn planting date.
 */
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
}

export function eventsForPlanting(
  planting: PlantingRecord,
  crop: CropPlugin,
  ctx: EventContext = {}
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
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

  // Emergence
  const emergence = readEmergenceDays(crop) ?? DEFAULT_EMERGENCE_DAYS;
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

  // Spray windows for corn families: V2-V3 (POST broadleaf) + V4-V6 (Mesotrione)
  if (crop.cropFamily === 'corn') {
    events.push({
      kind: 'spray-window',
      blockId: planting.blockId,
      cropId: planting.id,
      cropPluginId: planting.cropPluginId,
      varietyDisplayName: planting.varietyDisplayName,
      startMs: plant + 18 * DAY_MS,
      endMs: plant + 22 * DAY_MS,
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
      startMs: plant + 28 * DAY_MS,
      endMs: plant + 35 * DAY_MS,
      title: 'POST grass + late broadleaf window (V4–V6)',
      body: 'Window for Mesotrione + Stadia. Verify decon if sprayer last ran auxin.',
      detail: { stage: 'V4-V6' }
    });

    // Three Sisters companion plant trigger
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

  // Cucurbit POST grass window (Clethodim) — generic offset
  if (crop.cropFamily === 'cucurbit') {
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
  if (crop.cropFamily === 'cover-grass' || crop.cropFamily === 'cover-legume') {
    const nextCashCrop = (ctx.blockPlantings ?? [])
      .filter(
        (p) => p.id !== planting.id && p.plantingDate > plant
        // The cash-crop check is family-aware in the caller; here we only
        // need "any other planting after this cover crop in the same block."
      )
      .sort((a, b) => a.plantingDate - b.plantingDate)[0];

    if (nextCashCrop) {
      // Spec FR-18: terminate ≥14 days before the next cash-crop plant date.
      // Window opens 21 days prior, closes 14 days prior — the operator has
      // a 7-day window to do the burndown.
      events.push({
        kind: 'cover-termination',
        blockId: planting.blockId,
        cropId: planting.id,
        cropPluginId: planting.cropPluginId,
        varietyDisplayName: planting.varietyDisplayName,
        startMs: nextCashCrop.plantingDate - 21 * DAY_MS,
        endMs: nextCashCrop.plantingDate - 14 * DAY_MS,
        title: `Terminate cover: ${planting.varietyDisplayName}`,
        body: `Burndown ≥14 days before ${nextCashCrop.varietyDisplayName} planting on ${new Date(nextCashCrop.plantingDate).toLocaleDateString()}.`,
        detail: { nextCashCropPlantingId: nextCashCrop.id, anchorDate: nextCashCrop.plantingDate }
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
    const isPerennial =
      crop.cropFamily === 'orchard' ||
      crop.cropFamily === 'stone-fruit' ||
      crop.cropFamily === 'small-fruit' ||
      crop.cropFamily === 'bramble' ||
      crop.cropFamily === 'vine-fruit' ||
      crop.cropFamily === 'forage';
    const years = isPerennial ? orchardSeasonYears(plant) : [new Date(plant).getFullYear()];
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

  // Harvest window from DTM
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

  return events;
}

function readEmergenceDays(_crop: CropPlugin): { min: number; max: number } | undefined {
  // Emergence days live under the schema's loose `planting` blob today.
  // Phase 4.5 will tighten the schema; for now we accept the shape if present.
  // Returns undefined if the plugin doesn't carry it.
  return undefined;
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
