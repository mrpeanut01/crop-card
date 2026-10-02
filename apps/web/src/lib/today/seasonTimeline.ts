/**
 * The /today Season view: one timeline row per planting for a Season Setup
 * year, with spans for the grow period and each kind of job. Recorded work
 * is solid and planned or suggested work is dashed. Pure and client-safe.
 *
 * Season `year` holds the plantings whose planting date falls in that
 * calendar year (the key Season Setup, close-out and carry-forward use), and
 * undated plans when `year` is the active planning year. Its base window runs
 * from the planning rollover before it (eight weeks ahead of the prior fall
 * frost) to its own rollover, and grows to cover every span, so seasons can
 * overlap.
 */

import { calendarEventTitle } from '$lib/calendar/eventTitle';
import { frostDatesFromMmDd } from '$lib/schedule/frostSeason';
import { rolloverDateForSeason, type PlanningFrost } from '$lib/season/planningYear';
import type { TaskCategory } from '$lib/plan/taskCategory';
import { t as msg } from '$lib/i18n';
import { taskDisplayTitle } from '$lib/tasks/title';

export type SeasonSpanKind = 'grow' | 'plant' | 'till' | 'fertilize' | 'spray' | 'harvest';

export const SEASON_SPAN_LABEL: Record<SeasonSpanKind, string> = {
  grow: 'Growing',
  plant: 'Plant',
  till: 'Till or cultivate',
  fertilize: 'Feed',
  spray: 'Spray',
  harvest: 'Harvest'
};

export interface SeasonSpan {
  kind: SeasonSpanKind;
  startMs: number;
  endMs: number;
  /** Done and on record (solid), or planned or suggested (dashed). */
  recorded: boolean;
  label: string;
  /** Index into the input events when this span is a crop-calendar
   *  suggestion that can be scheduled. */
  suggestion?: number;
}

export interface SeasonRow {
  /** The planting's id, or `block:<blockId>` for a block's field work. */
  plantingId: string;
  /** Work on a block that no planting row holds: prep before planting, or
   *  a fallow block's till, burndown or feed (#467). */
  blockWork?: boolean;
  name: string;
  blockId: string;
  blockName: string;
  plantingDate: number | null;
  spans: SeasonSpan[];
}

export interface SeasonBand {
  startMs: number;
  endMs: number;
  source: 'frost' | 'plantings';
}

export interface SeasonTimeline {
  year: number;
  prepStartMs: number;
  nextPrepMs: number;
  fromMs: number;
  toMs: number;
  band: SeasonBand | null;
  rows: SeasonRow[];
}

export interface SeasonPlantingIn {
  id: string;
  name: string;
  blockId: string;
  blockName: string;
  plantingDate: number | null;
  status: string;
  harvestedAt?: number;
}

export interface SeasonEventIn {
  kind: string;
  blockId: string;
  cropId?: string;
  startMs: number;
  endMs: number;
  title: string;
  detail?: Record<string, unknown>;
}

export interface SeasonRecordIn {
  kind: 'spray' | 'harvest' | 'fertilize';
  blockId: string;
  cropId?: string;
  occurredAt: number;
  label: string;
}

export interface SeasonTaskIn {
  title: string;
  kind: string;
  blockId?: string;
  cropId?: string;
  scheduledFor: number;
  completedAt?: number;
  abortedAt?: number;
  category?: TaskCategory;
  relatedEventTable?: string;
  pluginTemplateKey?: string | null;
}

export interface SeasonTimelineInput {
  year: number;
  activePlanningYear: number;
  frost: PlanningFrost | null;
  plantings: readonly SeasonPlantingIn[];
  /** Plantings of other seasons. Work they still hold (an unnamed spray
   *  on a crop that is still in the ground) is left off the block rows. */
  otherPlantings?: readonly SeasonPlantingIn[];
  /** Block names for field-work rows on blocks with no planting. */
  blockNames?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  events: readonly SeasonEventIn[];
  records: readonly SeasonRecordIn[];
  tasks: readonly SeasonTaskIn[];
  now: number;
  /** The viewer's language for row and span labels; English when unset. */
  locale?: string | null;
}

/** The years the Season dropdown offers, newest first. */
export function seasonYears(input: {
  yearsWithPlantings: Iterable<number>;
  setupYears: Iterable<number>;
  activePlanningYear: number;
  now: number;
}): number[] {
  const set = new Set<number>([
    ...input.yearsWithPlantings,
    ...input.setupYears,
    input.activePlanningYear,
    new Date(input.now).getFullYear()
  ]);
  return [...set].filter((y) => Number.isInteger(y)).sort((a, b) => b - a);
}

/** The season a planting belongs to: the season whose prep window holds
 *  its planting date (a planting made after the rollover, when /plan has
 *  moved on to next year, belongs to next year's season), or the active
 *  planning year while it has no date. */
export function seasonOfPlanting(
  plantingDate: number | null,
  activePlanningYear: number,
  frost: PlanningFrost | null = null
): number {
  if (plantingDate === null) return activePlanningYear;
  const year = new Date(plantingDate).getFullYear();
  return plantingDate >= rolloverDateForSeason(year, frost).getTime() ? year + 1 : year;
}

export function seasonWindow(
  year: number,
  frost: PlanningFrost | null
): { prepStartMs: number; nextPrepMs: number } {
  return {
    prepStartMs: rolloverDateForSeason(year - 1, frost).getTime(),
    nextPrepMs: rolloverDateForSeason(year, frost).getTime()
  };
}

function spanKindForTask(t: SeasonTaskIn): SeasonSpanKind | null {
  switch (t.relatedEventTable) {
    case 'spray_event':
    case 'insecticide_event':
    case 'fungicide_event':
      return 'spray';
    case 'harvest_event':
    case 'hay_cutting':
      return 'harvest';
    case 'fertility_application':
      return 'fertilize';
  }
  switch (t.category) {
    case 'plant':
      return 'plant';
    case 'till':
      return 'till';
    case 'fertilize':
      return 'fertilize';
    case 'spray':
      return 'spray';
    case 'harvest':
    case 'hay-cutting':
      return 'harvest';
    default:
      return null;
  }
}

function spanKindForEvent(e: SeasonEventIn): SeasonSpanKind | null {
  switch (e.kind) {
    case 'spray-window':
      return 'spray';
    case 'harvest-window':
      return 'harvest';
    case 'cover-termination':
      return 'till';
    case 'orchard-task': {
      const key = String(e.detail?.taskKey ?? '');
      if (key === 'harvest') return 'harvest';
      if (/spray|fungicide|oil/.test(key)) return 'spray';
      return null;
    }
    default:
      return null;
  }
}

/**
 * Belongs to this planting: named for it, or on its block with no planting
 * named, on or after it went in and before the block's next planting.
 */
function belongs(
  item: { cropId?: string; blockId?: string },
  at: number,
  p: SeasonPlantingIn,
  nextOnBlock: number
): boolean {
  if (item.cropId) return item.cropId === p.id;
  if (item.blockId !== p.blockId || p.plantingDate === null) return false;
  if (at < p.plantingDate) return false;
  return at < nextOnBlock;
}

/** An other season's planting still holds unnamed work on its block from
 *  when it went in until its final harvest. */
function heldByOther(
  item: { blockId?: string },
  at: number,
  p: SeasonPlantingIn,
  nextOnBlock: number
): boolean {
  if (item.blockId !== p.blockId || p.plantingDate === null || at < p.plantingDate) return false;
  if (p.harvestedAt !== undefined && at > p.harvestedAt) return false;
  return at < nextOnBlock;
}

function nextPlantingOnBlock(p: SeasonPlantingIn, all: readonly SeasonPlantingIn[]): number {
  if (p.plantingDate === null) return Infinity;
  let next = Infinity;
  for (const o of all) {
    if (o.id === p.id || o.blockId !== p.blockId || o.plantingDate === null) continue;
    if (o.plantingDate > p.plantingDate && o.plantingDate < next) next = o.plantingDate;
  }
  return next;
}

export function buildSeasonTimeline(input: SeasonTimelineInput): SeasonTimeline {
  const { prepStartMs, nextPrepMs } = seasonWindow(input.year, input.frost);
  const plantings = input.plantings.filter(
    (p) => seasonOfPlanting(p.plantingDate, input.activePlanningYear, input.frost) === input.year
  );
  const dated = plantings.filter((p) => p.plantingDate !== null);
  const spanFloor = dated.length
    ? Math.min(prepStartMs, ...dated.map((p) => p.plantingDate as number))
    : prepStartMs;
  const inSeason = (ms: number) => ms >= spanFloor;

  const rows: SeasonRow[] = [];
  for (const p of plantings) {
    const spans: SeasonSpan[] = [];
    const nextOnBlock = nextPlantingOnBlock(p, input.plantings);
    const planted =
      p.status !== 'planned' && p.plantingDate !== null && p.plantingDate <= input.now;
    if (p.plantingDate !== null) {
      spans.push({
        kind: 'plant',
        startMs: p.plantingDate,
        endMs: p.plantingDate,
        recorded: planted,
        label: msg(input.locale, planted ? 'today.tl.planted' : 'today.tl.plannedPlanting')
      });
    }
    input.events.forEach((e, index) => {
      if (e.cropId !== p.id) return;
      const kind = spanKindForEvent(e);
      if (!kind) return;
      spans.push({
        kind,
        startMs: e.startMs,
        endMs: Math.max(e.startMs, e.endMs),
        recorded: false,
        label: calendarEventTitle({ ...e, varietyDisplayName: p.name }, input.locale),
        suggestion: index
      });
    });
    for (const r of input.records) {
      if (!belongs(r, r.occurredAt, p, nextOnBlock) || !inSeason(r.occurredAt)) continue;
      spans.push({
        kind: r.kind,
        startMs: r.occurredAt,
        endMs: r.occurredAt,
        recorded: true,
        label: r.label
      });
    }
    for (const t of input.tasks) {
      if (t.kind !== 'primary' || t.abortedAt !== undefined) continue;
      if (!belongs(t, t.scheduledFor, p, nextOnBlock) || !inSeason(t.scheduledFor)) continue;
      const kind = spanKindForTask(t);
      if (!kind) continue;
      if (kind === 'plant' && p.plantingDate !== null) continue;
      const at = t.completedAt ?? t.scheduledFor;
      spans.push({
        kind,
        startMs: at,
        endMs: at,
        recorded: t.completedAt !== undefined,
        label: taskDisplayTitle(t, input.locale)
      });
    }
    if (p.plantingDate !== null) {
      const harvestEnds = spans.filter((s) => s.kind === 'harvest').map((s) => s.endMs);
      const growEnd =
        p.harvestedAt ??
        (harvestEnds.length ? Math.max(...harvestEnds) : Math.max(...spans.map((s) => s.endMs)));
      if (growEnd > p.plantingDate) {
        spans.unshift({
          kind: 'grow',
          startMs: p.plantingDate,
          endMs: growEnd,
          recorded: planted,
          label: msg(input.locale, planted ? 'today.tl.growing' : 'today.tl.plannedGrowing')
        });
      }
    }
    spans.sort((a, b) => (a.kind === 'grow' ? -1 : b.kind === 'grow' ? 1 : a.startMs - b.startMs));
    rows.push({
      plantingId: p.id,
      name: p.name,
      blockId: p.blockId,
      blockName: p.blockName,
      plantingDate: p.plantingDate,
      spans
    });
  }
  rows.push(...blockWorkRows(input, plantings, prepStartMs, nextPrepMs));
  const sortAt = (r: SeasonRow) =>
    r.blockWork ? Math.min(...r.spans.map((s) => s.startMs)) : r.plantingDate;
  rows.sort((a, b) => {
    const at = sortAt(a);
    const bt = sortAt(b);
    if (at === null) return bt === null ? a.name.localeCompare(b.name) : 1;
    if (bt === null) return -1;
    return at - bt || a.name.localeCompare(b.name);
  });

  const allSpans = rows.flatMap((r) => r.spans);
  let band: SeasonBand | null = null;
  if (input.frost?.lastSpring && input.frost.firstFall) {
    const f = frostDatesFromMmDd(input.year, input.frost.lastSpring, input.frost.firstFall);
    band = { startMs: f.lastSpringFrostMs, endMs: f.firstFallFrostMs, source: 'frost' };
  } else if (allSpans.length) {
    const grows = allSpans.filter((s) => s.kind === 'grow' || s.kind === 'plant');
    if (grows.length) {
      band = {
        startMs: Math.min(...grows.map((s) => s.startMs)),
        endMs: Math.max(...grows.map((s) => s.endMs)),
        source: 'plantings'
      };
    }
  }

  const starts = [prepStartMs, ...allSpans.map((s) => s.startMs)];
  const ends = [nextPrepMs, ...allSpans.map((s) => s.endMs)];
  if (band) {
    starts.push(band.startMs);
    ends.push(band.endMs);
  }
  return {
    year: input.year,
    prepStartMs,
    nextPrepMs,
    fromMs: Math.min(...starts),
    toMs: Math.max(...ends),
    band,
    rows
  };
}

/**
 * One row per block for recorded or planned work with no planting named
 * that no planting of this season holds (#467): tilling, a burndown spray
 * or a pre-plant feed before the crop goes in, or work on a block with no
 * planting yet. Limited to this season's prep-to-prep window.
 */
function blockWorkRows(
  input: SeasonTimelineInput,
  plantings: readonly SeasonPlantingIn[],
  prepStartMs: number,
  nextPrepMs: number
): SeasonRow[] {
  const all = [...plantings, ...(input.otherPlantings ?? [])];
  const next = new Map(all.map((p) => [p.id, nextPlantingOnBlock(p, all)]));
  const others = input.otherPlantings ?? [];
  const held = (item: { cropId?: string; blockId?: string }, at: number) =>
    plantings.some((p) => belongs(item, at, p, next.get(p.id) ?? Infinity)) ||
    others.some((p) => heldByOther(item, at, p, next.get(p.id) ?? Infinity));
  const inWindow = (at: number) => at >= prepStartMs && at < nextPrepMs;
  const names = input.blockNames;
  const nameOf = (blockId: string): string => {
    const fromMap =
      names instanceof Map
        ? names.get(blockId)
        : (names as Readonly<Record<string, string>> | undefined)?.[blockId];
    return (
      fromMap ??
      plantings.find((p) => p.blockId === blockId)?.blockName ??
      msg(input.locale, 'today.tl.unnamedBlock')
    );
  };

  const byBlock = new Map<string, SeasonSpan[]>();
  const add = (blockId: string, span: SeasonSpan) => {
    const list = byBlock.get(blockId) ?? [];
    list.push(span);
    byBlock.set(blockId, list);
  };
  for (const r of input.records) {
    if (r.cropId || r.kind === 'harvest' || !inWindow(r.occurredAt)) continue;
    if (held(r, r.occurredAt)) continue;
    add(r.blockId, {
      kind: r.kind,
      startMs: r.occurredAt,
      endMs: r.occurredAt,
      recorded: true,
      label: r.label
    });
  }
  for (const t of input.tasks) {
    if (t.kind !== 'primary' || t.abortedAt !== undefined || t.cropId || !t.blockId) continue;
    if (!inWindow(t.scheduledFor) || held(t, t.scheduledFor)) continue;
    const kind = spanKindForTask(t);
    if (!kind || kind === 'harvest') continue;
    const at = t.completedAt ?? t.scheduledFor;
    add(t.blockId, {
      kind,
      startMs: at,
      endMs: at,
      recorded: t.completedAt !== undefined,
      label: taskDisplayTitle(t, input.locale)
    });
  }
  return [...byBlock].map(([blockId, spans]) => ({
    plantingId: `block:${blockId}`,
    blockWork: true,
    name: msg(input.locale, 'today.tl.fieldWork'),
    blockId,
    blockName: nameOf(blockId),
    plantingDate: null,
    spans: spans.sort((a, b) => a.startMs - b.startMs)
  }));
}
