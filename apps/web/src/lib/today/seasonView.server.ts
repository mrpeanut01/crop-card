import { listBlocks } from '$lib/db/blocks';
import { listCrops, listYearsWithCrops } from '$lib/db/crops';
import { listFertilityApplicationsForBlock } from '$lib/db/fertility';
import { listFungicideEvents } from '$lib/db/fungicideEvents';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listInsecticideEvents } from '$lib/db/insecticideEvents';
import { listSprayEvents } from '$lib/db/sprayEvents';
import { listTasks } from '$lib/db/tasks';
import { eventsForPlanting, type CalendarEvent } from '$lib/calendar/engine';
import type { PluginRegistry } from '$lib/plugins';
import type { CropPlugin } from '$lib/plugins/schemas';
import {
  getActivePlanningYear,
  listSeasonSetupYears,
  planningFrost
} from '$lib/season/planningYear.server';
import {
  buildSeasonTimeline,
  seasonOfPlanting,
  seasonWindow,
  seasonYears,
  type SeasonRecordIn,
  type SeasonTimeline
} from './seasonTimeline';

export interface SeasonViewData {
  year: number;
  years: number[];
  activePlanningYear: number;
  timeline: SeasonTimeline;
  /** Crop-calendar suggestions the timeline's dashed spans point at. */
  events: CalendarEvent[];
}

function parseYear(raw: string | null): number | null {
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  return Number(raw);
}

/**
 * The Season view for `?season=YYYY`, defaulting to the active planning
 * year. When that season has nothing in it yet but the one before still has
 * work running past today, the earlier season opens instead.
 */
export function loadSeasonView(
  registry: PluginRegistry,
  rawYear: string | null,
  now: number
): SeasonViewData {
  const activePlanningYear = getActivePlanningYear(new Date(now));
  const frost = planningFrost();
  const blocks = listBlocks({ plantings: 'none' });
  const blockName = new Map(blocks.map((b) => [b.id, b.name]));
  const crops = listCrops().filter((c) => c.status !== 'archived' || c.plantingDate !== null);
  const years = seasonYears({
    yearsWithPlantings: listYearsWithCrops(),
    setupYears: listSeasonSetupYears(),
    activePlanningYear,
    now
  });

  const requested = parseYear(rawYear);
  const minYear = Math.min(...years) - 1;
  const maxYear = Math.max(...years) + 1;

  const plantingsFor = (year: number) =>
    crops.filter((c) => seasonOfPlanting(c.plantingDate, activePlanningYear, frost) === year);

  let year = requested !== null && requested >= minYear && requested <= maxYear ? requested : null;
  if (year === null) {
    year = activePlanningYear;
    if (plantingsFor(year).length === 0 && plantingsFor(year - 1).length > 0) {
      const prev = buildFor(year - 1);
      if (prev.timeline.toMs >= now) return prev;
    }
  }
  return buildFor(year);

  function toPlantingIn(c: (typeof crops)[number]) {
    return {
      id: c.id,
      name: c.varietyDisplayName,
      blockId: c.blockId,
      blockName: blockName.get(c.blockId) ?? 'Unnamed block',
      plantingDate: c.plantingDate,
      status: c.status,
      harvestedAt: c.harvestedAt
    };
  }

  function buildFor(y: number): SeasonViewData {
    const season = plantingsFor(y);
    const byBlock = new Map<string, typeof crops>();
    for (const c of crops) {
      const list = byBlock.get(c.blockId) ?? [];
      list.push(c);
      byBlock.set(c.blockId, list);
    }
    const events: CalendarEvent[] = [];
    for (const c of season) {
      if (c.plantingDate === null) continue;
      const rec = registry.get(c.cropPluginId);
      if (!rec || rec.plugin.type !== 'crop') continue;
      const record = {
        id: c.id,
        blockId: c.blockId,
        cropPluginId: c.cropPluginId,
        varietyDisplayName: c.varietyDisplayName,
        plantingDate: c.plantingDate
      };
      const blockPlantings = (byBlock.get(c.blockId) ?? []).map((o) => ({
        id: o.id,
        blockId: o.blockId,
        cropPluginId: o.cropPluginId,
        varietyDisplayName: o.varietyDisplayName,
        plantingDate: o.plantingDate
      }));
      events.push(...eventsForPlanting(record, rec.plugin as CropPlugin, { blockPlantings }));
    }

    const { prepStartMs } = seasonWindow(y, frost);
    const { nextPrepMs: followingEnd } = seasonWindow(y + 1, frost);
    const dates = season.flatMap((c) => (c.plantingDate === null ? [] : [c.plantingDate]));
    const fromMs = Math.min(prepStartMs, ...dates);
    const range = { fromMs, toMs: followingEnd };
    const records: SeasonRecordIn[] = [];
    for (const e of listSprayEvents(range))
      records.push({
        kind: 'spray',
        blockId: e.blockId,
        cropId: e.cropId,
        occurredAt: e.occurredAt,
        label: 'Herbicide spray'
      });
    for (const e of listInsecticideEvents(range))
      records.push({
        kind: 'spray',
        blockId: e.blockId,
        cropId: e.cropId,
        occurredAt: e.occurredAt,
        label: 'Insecticide spray'
      });
    for (const e of listFungicideEvents(range))
      records.push({
        kind: 'spray',
        blockId: e.blockId,
        cropId: e.cropId,
        occurredAt: e.occurredAt,
        label: 'Fungicide spray'
      });
    for (const e of listHarvestEvents(range))
      records.push({
        kind: 'harvest',
        blockId: e.blockId,
        cropId: e.cropId,
        occurredAt: e.occurredAt,
        label: 'Harvested'
      });
    for (const { id: blockId } of blocks) {
      for (const a of listFertilityApplicationsForBlock(blockId)) {
        if (a.occurredAt < range.fromMs || a.occurredAt > range.toMs) continue;
        records.push({
          kind: 'fertilize',
          blockId: a.blockId,
          cropId: a.cropId,
          occurredAt: a.occurredAt,
          label: 'Fertilizer applied'
        });
      }
    }
    const tasks = listTasks(range);

    const timeline = buildSeasonTimeline({
      year: y,
      activePlanningYear,
      frost,
      plantings: season.map(toPlantingIn),
      otherPlantings: crops.filter((c) => !season.includes(c)).map(toPlantingIn),
      blockNames: blockName,
      events,
      records,
      tasks,
      now
    });
    return {
      year: y,
      years: [...new Set([...years, y])].sort((a, b) => b - a),
      activePlanningYear,
      timeline,
      events
    };
  }
}
