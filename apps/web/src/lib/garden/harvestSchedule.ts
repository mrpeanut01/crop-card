/** Phase 37C: what the garden will give and when, against the brief's
 *  storage goals. Pure and client-safe. Expected cuts come from the
 *  calendar engine's harvest windows plus a sourced cadence; nothing here
 *  counts jars, bunches or pounds. */

import type { LifecycleVerdict } from './lifecycleTypes';
import { INFUSE_MEDIA, infuseMediaOf, type InfuseMedium } from './infuse';
import {
  goalMethod,
  type BriefStorageGoal,
  type PreservingMethod,
  type PreservingSuitability
} from './preserving';

const DAY_MS = 86_400_000;

export interface HarvestWindowInput {
  startMs: number;
  endMs: number;
  /** `fallback` when the engine marks the window as typical timing. */
  provenance: 'plugin' | 'fallback';
}

export interface CadenceInput {
  everyDays: { min: number; max: number };
}

export interface SchedulePlantingInput {
  plantingId: string;
  cropPluginId: string;
  blockId: string;
  /** The engine's `harvest-window` events for this planting. */
  windows: readonly HarvestWindowInput[];
  cadence?: CadenceInput | null;
  /** 37B's verdict when the caller has one; absent reads as not known. */
  lifecycle?: LifecycleVerdict | null;
}

export interface ScheduleBounds {
  /** UTC-midnight ms of the season's first day. */
  seasonStartMs: number;
  /** UTC-midnight ms of the season's last day. */
  seasonEndMs: number;
  /** UTC-midnight ms of the first fall frost; cuts on frost-tender herbs stop
   *  here. */
  firstFallFrostMs: number;
}

export type CutKind = 'window' | 'cadence';

export interface ExpectedCut {
  plantingId: string;
  cropPluginId: string;
  blockId: string;
  kind: CutKind;
  /** Earliest and latest the cut is expected, UTC-midnight ms. */
  fromMs: number;
  toMs: number;
  /** Monday of the week the cut opens in, YYYY-MM-DD (UTC). */
  week: string;
  provenance: 'plugin' | 'fallback';
}

export type ScheduleEnd = 'first-fall-frost' | 'season-end';

export interface PlantingSchedule {
  plantingId: string;
  cropPluginId: string;
  cuts: ExpectedCut[];
  /** Why the cuts stop where they do. */
  endsAt: ScheduleEnd;
  /** No sourced cadence, so only the first harvest window shows. */
  firstWindowOnly: boolean;
}

export interface ScheduleWeek {
  week: string;
  cuts: ExpectedCut[];
}

export interface HarvestSchedule {
  plantings: PlantingSchedule[];
  weeks: ScheduleWeek[];
}

/** Monday of the UTC week holding `ms`, as YYYY-MM-DD. */
export function weekOf(ms: number): string {
  const day = Math.floor(ms / DAY_MS) * DAY_MS;
  const dow = new Date(day).getUTCDay();
  const monday = day - ((dow + 6) % 7) * DAY_MS;
  return new Date(monday).toISOString().slice(0, 10);
}

/** Hardy perennials keep giving to the end of the season; everything else
 *  (annuals, biennials, tender perennials and herbs whose lifecycle here is
 *  not known) stops at the first fall frost. */
export function scheduleEnd(lifecycle: LifecycleVerdict | null | undefined): ScheduleEnd {
  return lifecycle?.lifecycle === 'perennial-here' ? 'season-end' : 'first-fall-frost';
}

function cut(
  p: SchedulePlantingInput,
  kind: CutKind,
  fromMs: number,
  toMs: number,
  provenance: 'plugin' | 'fallback'
): ExpectedCut {
  return {
    plantingId: p.plantingId,
    cropPluginId: p.cropPluginId,
    blockId: p.blockId,
    kind,
    fromMs,
    toMs,
    week: weekOf(fromMs),
    provenance
  };
}

/** One planting's expected cuts inside the season. The first harvest window
 *  is the first cut; with a cadence, each later cut opens `min` to `max`
 *  days after the one before and is counted only when its latest day still
 *  falls before the end, so the schedule never promises a cut past frost. */
export function plantingSchedule(
  p: SchedulePlantingInput,
  bounds: ScheduleBounds
): PlantingSchedule {
  const endsAt = scheduleEnd(p.lifecycle);
  const endMs =
    endsAt === 'season-end'
      ? bounds.seasonEndMs
      : Math.min(bounds.firstFallFrostMs, bounds.seasonEndMs);
  const cadence = p.cadence && p.cadence.everyDays.min > 0 ? p.cadence : null;
  const windows = [...p.windows]
    .filter((w) => Number.isFinite(w.startMs) && Number.isFinite(w.endMs) && w.startMs <= w.endMs)
    .filter((w) => w.endMs >= bounds.seasonStartMs && w.startMs <= endMs)
    .sort((a, b) => a.startMs - b.startMs);
  const cuts: ExpectedCut[] = [];
  const first = windows[0];
  if (first) {
    const from = Math.max(first.startMs, bounds.seasonStartMs);
    const to = Math.min(first.endMs, endMs);
    cuts.push(cut(p, 'window', from, to, first.provenance));
    if (cadence) {
      const { min, max } = cadence.everyDays;
      for (let k = 1; k <= 400; k++) {
        const lo = from + k * min * DAY_MS;
        const hi = from + k * max * DAY_MS;
        if (hi > endMs) break;
        cuts.push(cut(p, 'cadence', lo, hi, 'plugin'));
      }
    }
  }
  return {
    plantingId: p.plantingId,
    cropPluginId: p.cropPluginId,
    cuts,
    endsAt,
    firstWindowOnly: !cadence
  };
}

export function buildHarvestSchedule(
  plantings: readonly SchedulePlantingInput[],
  bounds: ScheduleBounds
): HarvestSchedule {
  const out = plantings.map((p) => plantingSchedule(p, bounds));
  const byWeek = new Map<string, ExpectedCut[]>();
  for (const s of out) {
    for (const c of s.cuts) {
      const list = byWeek.get(c.week);
      if (list) list.push(c);
      else byWeek.set(c.week, [c]);
    }
  }
  const weeks = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, cuts]) => ({
      week,
      cuts: cuts.sort((a, b) => a.fromMs - b.fromMs || a.cropPluginId.localeCompare(b.cropPluginId))
    }));
  return { plantings: out, weeks };
}

// ─── Goals ──────────────────────────────────────────────────────────────

export interface GoalInput {
  goal: BriefStorageGoal;
  /** The owner's own words ("enough dried oregano for the year"). */
  target?: string | null;
}

export interface PreservingRow {
  method: PreservingMethod;
  suitability: PreservingSuitability;
  /** CO-4: an infuse row names what the herb goes into. */
  medium?: InfuseMedium;
}

/** What `goalStatus` needs to know about a crop plugin. */
export interface GoalPlugin {
  pluginId: string;
  preserving?: readonly PreservingRow[];
}

export type GoalStatus = 'on-track' | 'short' | 'not-known';

export type GoalReason =
  /** A suitable crop has a cut this season. */
  | 'suitable-cut'
  /** Canning and jelly: no plant data can answer it (R-6). */
  | 'needs-recipe'
  /** No planted crop has preserving data for the method. */
  | 'no-data'
  /** Data says the planted crops keep poorly this way. */
  | 'only-poor'
  /** A suitable crop is planted but has no cut this season. */
  | 'no-cut'
  /** Nothing is planted, and the library has a crop that keeps this way. */
  | 'nothing-planted';

export interface GoalLine {
  goal: BriefStorageGoal;
  target: string | null;
  method: PreservingMethod | null;
  status: GoalStatus;
  reason: GoalReason;
  /** The crop that puts the goal on track, and how well it keeps (R-7). */
  cropPluginId?: string;
  suitability?: 'good' | 'fair';
  provenance: 'plugin' | 'fallback';
}

const SUITABILITY_RANK: Record<PreservingSuitability, number> = { good: 0, fair: 1, poor: 2 };

/** The crop's best row for a method. An herb can carry two infuse rows (oil
 *  and vinegar, CO-4); the better rated one judges the goal, and on a tie
 *  vinegar, which keeps with fewer rules, comes first. */
export function bestPreservingRow<R extends PreservingRow>(
  rows: readonly R[] | undefined,
  method: PreservingMethod
): R | undefined {
  let best: R | undefined;
  for (const r of rows ?? []) {
    if (r.method !== method) continue;
    const rank = SUITABILITY_RANK[r.suitability];
    const bestRank = best ? SUITABILITY_RANK[best.suitability] : Infinity;
    if (rank < bestRank || (rank === bestRank && r.medium === 'vinegar')) best = r;
  }
  return best;
}

function rowFor(plugin: GoalPlugin | undefined, method: PreservingMethod) {
  return bestPreservingRow(plugin?.preserving, method);
}

function isSuitable(s: PreservingSuitability | undefined): s is 'good' | 'fair' {
  return s === 'good' || s === 'fair';
}

/** R-7: each goal is `on-track` only when a planting of a crop that keeps
 *  `good` or `fair` by the goal's method has a cut in the schedule; a `good`
 *  crop is named before a `fair` one. With no plant data it is `not-known`,
 *  never `short`. `library` lets a farm with nothing planted read `short`
 *  when some crop in the library keeps that way. */
export function goalStatus(
  goals: readonly GoalInput[],
  plantings: readonly PlantingSchedule[],
  plugins: Readonly<Record<string, GoalPlugin>>,
  library: readonly GoalPlugin[] = []
): GoalLine[] {
  return goals.map((g): GoalLine => {
    const method = goalMethod(g.goal);
    const base = { goal: g.goal, target: g.target?.trim() || null, method };
    if (!method) {
      return { ...base, status: 'not-known', reason: 'needs-recipe', provenance: 'fallback' };
    }
    const rows = plantings.map((p) => ({ p, row: rowFor(plugins[p.cropPluginId], method) }));
    const cutting = rows
      .filter((r) => isSuitable(r.row?.suitability) && r.p.cuts.length > 0)
      .sort(
        (a, b) =>
          (a.row!.suitability === 'good' ? 0 : 1) - (b.row!.suitability === 'good' ? 0 : 1) ||
          a.p.cropPluginId.localeCompare(b.p.cropPluginId)
      );
    const best = cutting[0];
    if (best) {
      return {
        ...base,
        status: 'on-track',
        reason: 'suitable-cut',
        cropPluginId: best.p.cropPluginId,
        suitability: best.row!.suitability as 'good' | 'fair',
        provenance: 'plugin'
      };
    }
    if (rows.some((r) => isSuitable(r.row?.suitability))) {
      return { ...base, status: 'short', reason: 'no-cut', provenance: 'plugin' };
    }
    if (rows.some((r) => r.row)) {
      return { ...base, status: 'short', reason: 'only-poor', provenance: 'plugin' };
    }
    if (plantings.length === 0 && library.some((l) => isSuitable(rowFor(l, method)?.suitability))) {
      return { ...base, status: 'short', reason: 'nothing-planted', provenance: 'plugin' };
    }
    return { ...base, status: 'not-known', reason: 'no-data', provenance: 'fallback' };
  });
}

/** CO-10: the media whose safety line shows beside an infuse goal, on track
 *  or not: the medium of the row that puts the goal on track, else every
 *  medium a planted herb infuses in, else both (the goal is "Vinegars and
 *  oils"). Empty for any other goal. */
export function infuseGoalMedia(
  line: Pick<GoalLine, 'goal' | 'status' | 'cropPluginId'>,
  plantings: ReadonlyArray<{ cropPluginId: string; preserving?: readonly PreservingRow[] }>
): InfuseMedium[] {
  if (line.goal !== 'infuse') return [];
  if (line.status === 'on-track' && line.cropPluginId) {
    const crop = plantings.find((p) => p.cropPluginId === line.cropPluginId);
    const medium = bestPreservingRow(crop?.preserving, 'infuse')?.medium;
    if (medium) return [medium];
  }
  const media = new Set(plantings.flatMap((p) => infuseMediaOf(p.preserving)));
  return media.size ? INFUSE_MEDIA.filter((m) => media.has(m)) : [...INFUSE_MEDIA];
}
