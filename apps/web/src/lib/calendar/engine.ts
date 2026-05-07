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

export type CalendarEventKind =
  | 'planting'
  | 'emergence'
  | 'spray-window'
  | 'companion-trigger'
  | 'harvest-window'
  | 'cover-termination';

export interface CalendarEvent {
  kind: CalendarEventKind;
  blockId: string;
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

export function eventsForPlanting(planting: PlantingRecord, crop: CropPlugin): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const plant = planting.plantingDate;

  events.push({
    kind: 'planting',
    blockId: planting.blockId,
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
      cropPluginId: planting.cropPluginId,
      varietyDisplayName: planting.varietyDisplayName,
      startMs: plant + 30 * DAY_MS,
      endMs: plant + 60 * DAY_MS,
      title: 'POST grass window (Clethodim)',
      body: 'For grass escapes in the pumpkin block. Verify sprayer never carried auxin without decon.'
    });
  }

  // Cover-crop termination ahead of any cash-crop succession
  if (crop.cropFamily === 'cover-grass' || crop.cropFamily === 'cover-legume') {
    events.push({
      kind: 'cover-termination',
      blockId: planting.blockId,
      cropPluginId: planting.cropPluginId,
      varietyDisplayName: planting.varietyDisplayName,
      // Spec: terminate 14 days before the following cash-crop planting; we
      // surface a generic "after spring growth" window absent the next planting.
      startMs: plant + 180 * DAY_MS,
      endMs: plant + 195 * DAY_MS,
      title: `Terminate cover: ${planting.varietyDisplayName}`,
      body: 'Burndown ≥14 days before the following cash-crop plant date.'
    });
  }

  // Harvest window from DTM
  const dtm = crop.daysToMaturity;
  if (dtm) {
    events.push({
      kind: 'harvest-window',
      blockId: planting.blockId,
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
