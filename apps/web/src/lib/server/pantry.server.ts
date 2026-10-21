/** Phase 37C server side: the harvest schedule for a farm or one Area, the
 *  brief's goals, and this season's kept harvests. Every read is through
 *  tenant-scoped repos. */

import { listBlocks, type BlockWithPlantings, type PlantingRecord } from '$lib/db/blocks';
import { listHarvestEvents } from '$lib/db/harvestEvents';
import { listDispositionsForHarvests } from '$lib/db/harvestDispositions';
import { getSetting } from '$lib/db/settings';
import { farmTimeZone } from '$lib/db/userProfile';
import { eventsForPlanting } from '$lib/calendar/engine';
import { frostDatesForYear } from '$lib/schedule/settings';
import { getRegistry } from '$lib/server/registry';
import { HERB_PLUGIN_IDS, isHerbGardenCrop } from '$lib/garden/herbs';
import { lifecycleVerdictsFor } from './lifecycleLine.server';
import { BRIEF_SETTING_KEY, briefGoalsFromSetting, type BriefGoal } from '$lib/garden/briefGoals';
import {
  buildHarvestSchedule,
  goalStatus,
  type GoalLine,
  type GoalPlugin,
  type HarvestSchedule,
  type HarvestWindowInput,
  type ScheduleBounds,
  type SchedulePlantingInput
} from '$lib/garden/harvestSchedule';
import type { LifecycleVerdict } from '$lib/garden/lifecycleTypes';
import type { PreservingMethod } from '$lib/garden/preserving';
import type { CropPlugin } from '$lib/plugins/schemas';
import { ymdInZone } from '$lib/prefs';
import { zonedDayStartMs } from '$lib/exports/dateRange';
import { cropDisplayName } from '$lib/i18n/cropName';
import type { HarvestScheduleResponse } from '$lib/garden/harvestScheduleApi';
import { harvestTimingHints } from '$lib/garden/harvestTiming';
import { pantryCutTaskText } from '$lib/garden/pantryCutTask';

const DAY_MS = 86_400_000;
const LIVE = new Set(['planned', 'active']);

/** 37B's verdict per crop plugin, when the integrator wires it in. */
export type LifecycleLookup = (plugin: CropPlugin) => LifecycleVerdict | null;

export interface ScheduleScope {
  /** Only plantings in this Area; otherwise the whole farm. */
  areaId?: string | null;
  /** Only `HERB_PLUGIN_IDS` crops (the farm-wide pantry view). */
  herbsOnly?: boolean;
  now?: number;
  lifecycleFor?: LifecycleLookup;
}

export interface ScheduledPlanting {
  plantingId: string;
  cropPluginId: string;
  /** The planting's own name, English (the caller localizes it). */
  varietyDisplayName: string;
  blockId: string;
  blockName: string;
  /** How the crop keeps, from plugin data; empty when not known. */
  preserving: NonNullable<CropPlugin['preserving']>;
  /** #867: the sourced cutting stage per method; empty when not known. */
  harvestTiming: NonNullable<CropPlugin['harvestTiming']>;
}

export interface LoadedSchedule {
  year: number;
  bounds: ScheduleBounds;
  schedule: HarvestSchedule;
  plantings: ScheduledPlanting[];
  plugins: Record<string, GoalPlugin>;
}

/** The farm's current season: its calendar year in the farm's zone. */
export function seasonYear(now: number = Date.now()): number {
  return Number(ymdInZone(now, farmTimeZone()).slice(0, 4));
}

export function seasonBounds(year: number): ScheduleBounds {
  const { firstFallFrostMs } = frostDatesForYear(year);
  return {
    seasonStartMs: Date.UTC(year, 0, 1),
    seasonEndMs: Math.max(Date.UTC(year, 11, 31), firstFallFrostMs),
    firstFallFrostMs
  };
}

function windowsFor(
  planting: PlantingRecord,
  crop: CropPlugin,
  block: BlockWithPlantings,
  now: number
): HarvestWindowInput[] {
  return eventsForPlanting(planting, crop, { blockPlantings: block.plantings, now })
    .filter((e) => e.kind === 'harvest-window' && e.cropId === planting.id)
    .map((e) => ({
      startMs: e.startMs,
      endMs: e.endMs,
      provenance: e.detail?.typicalTiming ? 'fallback' : 'plugin'
    }));
}

/** 37B's verdict for every live herb planting's crop, loaded once so the
 *  farm zone is read at most once per schedule. */
async function herbLifecycleLookup(
  registry: Awaited<ReturnType<typeof getRegistry>>,
  scope: ScheduleScope,
  now: number
): Promise<LifecycleLookup> {
  const crops = new Map<string, CropPlugin>();
  for (const block of listBlocks({ plantings: 'current', now })) {
    if (scope.areaId && block.fieldId !== scope.areaId) continue;
    for (const p of block.plantings) {
      if (!isHerbGardenCrop(p.cropPluginId) || crops.has(p.cropPluginId)) continue;
      const rec = registry.get(p.cropPluginId);
      if (rec?.plugin.type === 'crop') crops.set(p.cropPluginId, rec.plugin);
    }
  }
  const verdicts = await lifecycleVerdictsFor(crops.values());
  return (plugin) => verdicts[plugin.pluginId] ?? null;
}

export async function loadHarvestSchedule(scope: ScheduleScope = {}): Promise<LoadedSchedule> {
  const now = scope.now ?? Date.now();
  const year = seasonYear(now);
  const bounds = seasonBounds(year);
  const registry = await getRegistry();
  const lifecycleFor = scope.lifecycleFor ?? (await herbLifecycleLookup(registry, scope, now));
  const inputs: SchedulePlantingInput[] = [];
  const plantings: ScheduledPlanting[] = [];
  const plugins: Record<string, GoalPlugin> = {};
  for (const block of listBlocks({ plantings: 'current', now })) {
    if (scope.areaId && block.fieldId !== scope.areaId) continue;
    for (const p of block.plantings) {
      if (p.status && !LIVE.has(p.status)) continue;
      if (scope.herbsOnly && !isHerbGardenCrop(p.cropPluginId)) continue;
      const rec = registry.get(p.cropPluginId);
      const crop = rec?.plugin.type === 'crop' ? rec.plugin : undefined;
      if (!crop) continue;
      plugins[crop.pluginId] = { pluginId: crop.pluginId, preserving: crop.preserving ?? [] };
      inputs.push({
        plantingId: p.id,
        cropPluginId: p.cropPluginId,
        blockId: block.id,
        windows: windowsFor(p, crop, block, now),
        cadence: crop.harvestCadence ?? null,
        lifecycle: lifecycleFor(crop)
      });
      plantings.push({
        plantingId: p.id,
        cropPluginId: p.cropPluginId,
        varietyDisplayName: p.varietyDisplayName,
        blockId: block.id,
        blockName: block.name,
        preserving: crop.preserving ?? [],
        harvestTiming: crop.harvestTiming ?? []
      });
    }
  }
  return { year, bounds, schedule: buildHarvestSchedule(inputs, bounds), plantings, plugins };
}

export function briefSaved(): boolean {
  return !!getSetting(BRIEF_SETTING_KEY);
}

/** The saved brief's storage goals; none when there is no brief. */
export function loadBriefGoals(): BriefGoal[] {
  return briefGoalsFromSetting(getSetting(BRIEF_SETTING_KEY));
}

/** Every herb in the library with its preserving data, for a farm with
 *  nothing planted. */
export async function herbLibrary(): Promise<GoalPlugin[]> {
  const registry = await getRegistry();
  const out: GoalPlugin[] = [];
  for (const id of HERB_PLUGIN_IDS) {
    const p = registry.get(id)?.plugin;
    if (p?.type === 'crop') out.push({ pluginId: p.pluginId, preserving: p.preserving ?? [] });
  }
  return out;
}

export async function goalLinesFor(
  loaded: LoadedSchedule,
  goals: BriefGoal[]
): Promise<GoalLine[]> {
  if (goals.length === 0) return [];
  const library = loaded.plantings.length === 0 ? await herbLibrary() : [];
  return goalStatus(goals, loaded.schedule.plantings, loaded.plugins, library);
}

export interface KeptTotal {
  cropPluginId: string;
  method: PreservingMethod | null;
  unit: string;
  quantity: number;
}

/** This season's kept dispositions summed by crop, method and unit. */
export function loadKeptTotals(year: number): KeptTotal[] {
  const zone = farmTimeZone();
  const fromMs = zonedDayStartMs(year, 1, 1, zone);
  const toMs = zonedDayStartMs(year + 1, 1, 1, zone) - 1;
  const harvests = listHarvestEvents({ fromMs, toMs });
  const cropOf = new Map(harvests.map((h) => [h.id, h.cropPluginId]));
  const totals = new Map<string, KeptTotal>();
  for (const [harvestId, list] of listDispositionsForHarvests(harvests.map((h) => h.id))) {
    const cropPluginId = cropOf.get(harvestId);
    if (!cropPluginId) continue;
    for (const d of list) {
      if (d.kind !== 'kept') continue;
      const unit = d.unit.trim().toLowerCase();
      const key = `${cropPluginId}\u0000${d.preservedAs ?? ''}\u0000${unit}`;
      const t = totals.get(key);
      if (t) t.quantity = Math.round((t.quantity + d.quantity) * 100) / 100;
      else totals.set(key, { cropPluginId, method: d.preservedAs, unit, quantity: d.quantity });
    }
  }
  return [...totals.values()].sort(
    (a, b) =>
      a.cropPluginId.localeCompare(b.cropPluginId) ||
      (a.method === null ? 1 : 0) - (b.method === null ? 1 : 0) ||
      (a.method ?? '').localeCompare(b.method ?? '') ||
      a.unit.localeCompare(b.unit)
  );
}

/** The next expected cut for a planting at or after this week, or null. */
export function nextCutFor(
  schedule: HarvestSchedule,
  plantingId: string,
  now: number
): { fromMs: number; week: string } | null {
  const thisWeekStart = now - 7 * DAY_MS;
  const s = schedule.plantings.find((p) => p.plantingId === plantingId);
  const cut = s?.cuts.find((c) => c.toMs >= thisWeekStart);
  return cut ? { fromMs: Math.max(cut.fromMs, now), week: cut.week } : null;
}

/** The schedule as `GET /api/garden/harvest-schedule` answers it, crop
 *  names in `locale`. */
export async function harvestScheduleResponse(
  scope: ScheduleScope & { locale?: string | null }
): Promise<HarvestScheduleResponse> {
  return (await harvestScheduleWithCutTasks(scope)).schedule;
}

/** The schedule plus, per planting, the English title and notes that
 *  "Schedule the next cut" saves (#868), whatever `locale` the page is in. */
export async function harvestScheduleWithCutTasks(
  scope: ScheduleScope & { locale?: string | null }
): Promise<{
  schedule: HarvestScheduleResponse;
  cutTasks: Record<string, { title: string; body: string }>;
}> {
  const now = scope.now ?? Date.now();
  const loaded = await loadHarvestSchedule({ ...scope, now });
  const briefGoals = loadBriefGoals();
  const goals = await goalLinesFor(loaded, briefGoals);
  const goalIds = briefGoals.map((g) => g.goal);
  const byId = new Map(loaded.plantings.map((p) => [p.plantingId, p]));
  const name = (p: ScheduledPlanting) =>
    cropDisplayName(p.cropPluginId, p.varietyDisplayName, scope.locale);
  const cutTasks: Record<string, { title: string; body: string }> = {};
  for (const p of loaded.plantings) {
    cutTasks[p.plantingId] = pantryCutTaskText(p.varietyDisplayName.trim() || p.cropPluginId);
  }
  const schedule: HarvestScheduleResponse = {
    year: loaded.year,
    weeks: loaded.schedule.weeks.map((w) => ({
      week: w.week,
      cuts: w.cuts.map((c) => {
        const p = byId.get(c.plantingId)!;
        return {
          plantingId: c.plantingId,
          cropPluginId: c.cropPluginId,
          cropName: name(p),
          blockName: p.blockName,
          kind: c.kind,
          fromMs: c.fromMs,
          toMs: c.toMs,
          provenance: c.provenance
        };
      })
    })),
    plantings: loaded.schedule.plantings.map((s) => {
      const p = byId.get(s.plantingId)!;
      return {
        plantingId: s.plantingId,
        cropPluginId: s.cropPluginId,
        cropName: name(p),
        blockName: p.blockName,
        endsAt: s.endsAt,
        firstWindowOnly: s.firstWindowOnly,
        cutCount: s.cuts.length,
        nextCut: nextCutFor(loaded.schedule, s.plantingId, now),
        preserving: p.preserving.map((r) => ({
          method: r.method,
          suitability: r.suitability,
          ...(r.note ? { note: r.note } : {})
        })),
        timing: harvestTimingHints(p, goalIds)
      };
    }),
    goals
  };
  return { schedule, cutTasks };
}
